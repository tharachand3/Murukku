import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';
import { mulRateQty } from '../src/lib/money.js';

const password = 'Demo@123';
const seedUsers = [
  { name: 'Admin', email: 'admin@demo.com', role: 'ADMIN' },
  { name: 'Production', email: 'production@demo.com', role: 'PRODUCTION' },
  { name: 'Salesman A', email: 'salesman.a@demo.com', role: 'SALESMAN' },
  { name: 'Salesman B', email: 'salesman.b@demo.com', role: 'SALESMAN' },
  { name: 'Accountant', email: 'accountant@demo.com', role: 'ACCOUNTANT' },
  { name: 'Owner', email: 'owner@demo.com', role: 'OWNER' }
];

const seedUnits = [
  { code: 'g', name: 'gram', dimension: 'MASS', baseFactor: 1 },
  { code: 'kg', name: 'kilogram', dimension: 'MASS', baseFactor: 1000 },
  { code: 'ml', name: 'millilitre', dimension: 'VOLUME', baseFactor: 1 },
  { code: 'l', name: 'litre', dimension: 'VOLUME', baseFactor: 1000 },
  { code: 'pcs', name: 'pieces', dimension: 'COUNT', baseFactor: 1 },
  { code: 'packet', name: 'packet', dimension: 'COUNT', baseFactor: 1 }
];

const seedSettings = [
  ['COMPANY_NAME', 'Sri Murugan Snacks (Demo)'],
  ['COMPANY_GSTIN', '33ABCDE1234F1Z5'],
  ['COMPANY_STATE_CODE', '33'],
  [
    'COMPANY_ADDRESS',
    'Demo Industrial Estate, Tiruchirappalli, Tamil Nadu 620015'
  ],
  ['VARIANCE_TOLERANCE_BP', '300'],
  ['FY_START_MONTH', '4']
];

const seedItems = [
  { code: 'FLOUR', name: 'Flour', type: 'RAW', baseUnit: 'g', displayUnit: 'kg' },
  { code: 'OIL', name: 'Oil', type: 'RAW', baseUnit: 'ml', displayUnit: 'l' },
  {
    code: 'SPICE',
    name: 'Salt and spice mix',
    type: 'RAW',
    baseUnit: 'g',
    displayUnit: 'kg'
  },
  {
    code: 'POUCH200',
    name: '200 g pouch',
    type: 'PACKAGING',
    baseUnit: 'pcs',
    displayUnit: 'pcs'
  },
  {
    code: 'CARTON',
    name: 'Carton (holds 20 packets)',
    type: 'PACKAGING',
    baseUnit: 'pcs',
    displayUnit: 'pcs'
  },
  {
    code: 'MURUKKU200',
    name: 'Murukku 200 g',
    type: 'FINISHED',
    baseUnit: 'packet',
    displayUnit: 'packet',
    hsnCode: '21069099',
    gstRateBp: 500,
    packsPerCarton: 20,
    sellingPricePaise: 5000
  }
];

const seedCustomers = [
  {
    name: 'Retailer A',
    type: 'RETAILER',
    gstin: '33AAAAA0000A1Z5',
    stateCode: '33',
    stateName: 'Tamil Nadu',
    salesmanEmail: 'salesman.a@demo.com'
  },
  {
    name: 'Distributor B',
    type: 'DISTRIBUTOR',
    gstin: '29BBBBB1111B1Z5',
    stateCode: '29',
    stateName: 'Karnataka',
    salesmanEmail: 'salesman.b@demo.com'
  }
];

const openingStock = [
  { code: 'FLOUR', qty: 100000, rate: '4.2' },
  { code: 'OIL', qty: 30000, rate: '14' },
  { code: 'SPICE', qty: 5000, rate: '20' },
  { code: 'POUCH200', qty: 500, rate: '250' },
  { code: 'CARTON', qty: 30, rate: '1500' },
  { code: 'MURUKKU200', qty: 50, rate: '3000' }
];

function currentFinancialYearStart() {
  const now = new Date();
  const year =
    now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return new Date(Date.UTC(year, 3, 1));
}

async function saveNamedRecord(model, name, createData, updateData) {
  const existing = await model.findFirst({
    where: { name },
    select: { id: true }
  });
  if (existing) {
    return model.update({ where: { id: existing.id }, data: updateData });
  }
  return model.create({ data: createData });
}

async function seedData(tx, passwordHash, movementDate) {
  const unitsByCode = new Map();
  for (const unit of seedUnits) {
    const savedUnit = await tx.unit.upsert({
      where: { code: unit.code },
      update: {
        name: unit.name,
        dimension: unit.dimension,
        baseFactor: unit.baseFactor
      },
      create: unit
    });
    unitsByCode.set(unit.code, savedUnit);
  }

  for (const [key, value] of seedSettings) {
    await tx.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });
  }

  const itemsByCode = new Map();
  for (const item of seedItems) {
    const data = {
      code: item.code,
      name: item.name,
      type: item.type,
      baseUnitId: unitsByCode.get(item.baseUnit).id,
      displayUnitId: unitsByCode.get(item.displayUnit).id,
      hsnCode: item.hsnCode ?? null,
      gstRateBp: item.gstRateBp ?? 0,
      packsPerCarton: item.packsPerCarton ?? null,
      sellingPricePaise: item.sellingPricePaise ?? null,
      isActive: true
    };
    const savedItem = await tx.item.upsert({
      where: { code: item.code },
      update: data,
      create: data
    });
    itemsByCode.set(item.code, savedItem);
  }

  await saveNamedRecord(
    tx.supplier,
    'Demo Flour Mills',
    { name: 'Demo Flour Mills', stateCode: '33', isActive: true },
    { stateCode: '33', isActive: true }
  );

  for (const customer of seedCustomers) {
    const data = {
      name: customer.name,
      type: customer.type,
      gstin: customer.gstin,
      stateCode: customer.stateCode,
      stateName: customer.stateName,
      isActive: true
    };
    await saveNamedRecord(
      tx.customer,
      customer.name,
      { ...data, assignedSalesmanId: null },
      data
    );
  }

  const usersByEmail = new Map();
  for (const user of seedUsers) {
    const existing = await tx.user.findUnique({
      where: { email: user.email }
    });
    const savedUser = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: { name: user.name, role: user.role, isActive: true }
        })
      : await tx.user.create({
          data: {
            ...user,
            passwordHash,
            isActive: true
          }
        });
    usersByEmail.set(user.email, savedUser);
  }

  for (const customer of seedCustomers) {
    const savedCustomer = await tx.customer.findFirst({
      where: { name: customer.name },
      select: { id: true }
    });
    await tx.customer.update({
      where: { id: savedCustomer.id },
      data: {
        assignedSalesmanId: usersByEmail.get(customer.salesmanEmail).id
      }
    });
  }

  const finishedItem = itemsByCode.get('MURUKKU200');
  const bom = await tx.bom.upsert({
    where: {
      finishedItemId_version: { finishedItemId: finishedItem.id, version: 1 }
    },
    update: {
      name: 'Murukku 200 g - standard batch',
      isActive: true,
      batchYieldQty: 200
    },
    create: {
      name: 'Murukku 200 g - standard batch',
      finishedItemId: finishedItem.id,
      version: 1,
      isActive: true,
      batchYieldQty: 200
    }
  });

  const bomLines = [
    ['FLOUR', 40000],
    ['OIL', 10000],
    ['SPICE', 1200],
    ['POUCH200', 200],
    ['CARTON', 10]
  ];
  for (const [itemCode, qtyPerBatch] of bomLines) {
    const item = itemsByCode.get(itemCode);
    await tx.bomLine.upsert({
      where: { bomId_itemId: { bomId: bom.id, itemId: item.id } },
      update: { qtyPerBatch },
      create: { bomId: bom.id, itemId: item.id, qtyPerBatch }
    });
  }

  for (const opening of openingStock) {
    const item = itemsByCode.get(opening.code);
    const existingOpening = await tx.stockMovement.findFirst({
      where: { itemId: item.id, movementType: 'OPENING' },
      select: { id: true }
    });
    if (existingOpening) {
      continue;
    }

    await tx.stockMovement.create({
      data: {
        itemId: item.id,
        movementType: 'OPENING',
        qtyChange: opening.qty,
        ratePaisePerBase: new Decimal(opening.rate),
        valuePaise: mulRateQty(opening.rate, opening.qty),
        sourceType: 'OPENING',
        sourceRef: 'OPENING',
        movementDate
      }
    });
  }
}

export async function seed(transactionClient) {
  const passwordHash = await bcrypt.hash(password, 10);
  const movementDate = currentFinancialYearStart();
  const applySeed = (tx) => seedData(tx, passwordHash, movementDate);

  if (transactionClient) {
    return applySeed(transactionClient);
  }

  const prisma = new PrismaClient();
  try {
    return await prisma.$transaction(applySeed, { timeout: 30000 });
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  try {
    await seed();
    console.log('Benchmark master data seeded.');
  } catch (error) {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
