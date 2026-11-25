import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { marginPerPacket } from '../../lib/costMath.js';
import {
  defineReport,
  formatIstDate,
  makeSection,
  periodFilterShape,
  resolvePeriod
} from '../../lib/reportKit.js';
import { getProductCosting } from '../costSheetService.js';

const filtersSchema = z.object({
  ...periodFilterShape.shape,
  finishedItemId: z.coerce.number().int().positive().max(2147483647).optional()
}).strict();

const filterDocs = [
  { name: 'from', type: 'date', description: 'First inclusive IST calendar day' },
  { name: 'to', type: 'date', description: 'Last inclusive IST calendar day' },
  { name: 'finishedItemId', type: 'int', description: 'Filter to one finished product' }
];

const productColumns = [
  { key: 'productCode', label: 'Product code', type: 'text' },
  { key: 'productName', label: 'Product', type: 'text' },
  { key: 'runs', label: 'Runs', type: 'int' },
  { key: 'goodQty', label: 'Good quantity', type: 'int' },
  { key: 'materialCostPaise', label: 'Material cost', type: 'money' },
  { key: 'overheadCostPaise', label: 'Overhead cost', type: 'money' },
  { key: 'totalCostPaise', label: 'Total cost', type: 'money' },
  { key: 'avgCostPerPacketPaise', label: 'Average cost per packet', type: 'moneyDecimal' },
  { key: 'sellingPricePaise', label: 'Selling price', type: 'money' },
  { key: 'marginPerPacketPaise', label: 'Margin per packet', type: 'moneyDecimal' },
  { key: 'marginPctBp', label: 'Margin (%)', type: 'percentBp' }
];

const runColumns = [
  { key: 'runNo', label: 'Run no.', type: 'text' },
  { key: 'productName', label: 'Product', type: 'text' },
  { key: 'completedDate', label: 'Completed date', type: 'date' },
  { key: 'goodQty', label: 'Good quantity', type: 'int' },
  { key: 'materialCostPaise', label: 'Material cost', type: 'money' },
  { key: 'overheadCostPaise', label: 'Overhead cost', type: 'money' },
  { key: 'totalCostPaise', label: 'Total cost', type: 'money' },
  { key: 'costPerPacketPaise', label: 'Cost per packet', type: 'moneyDecimal' },
  { key: 'marginPctBp', label: 'Margin (%)', type: 'percentBp' }
];

function safeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function marginFor(sellingPricePaise, costPerPacketPaise) {
  if (
    !Number.isSafeInteger(sellingPricePaise) ||
    sellingPricePaise <= 0 ||
    costPerPacketPaise === null
  ) {
    return { marginPerPacketPaise: null, marginPctBp: null };
  }
  const margin = marginPerPacket({ sellingPricePaise, costPerPacketPaise });
  return {
    marginPerPacketPaise: margin.marginPaise.toFixed(4),
    marginPctBp: margin.marginBp
  };
}

const productCosting = defineReport({
  key: 'product-costing',
  title: 'Product Costing',
  description: 'Completed production costs, average cost per packet, selling price, and margin.',
  group: 'costing',
  capability: 'costing:read',
  filtersSchema,
  filterDocs,
  sectionDocs: [
    { key: 'products', title: 'Product costing' },
    { key: 'runs', title: 'Completed production runs' }
  ],
  async run(db, filters) {
    const period = resolvePeriod(filters);
    const where = {
      status: 'COMPLETED',
      completedAt: { gte: period.start, lt: period.endExclusive },
      ...(filters.finishedItemId !== undefined
        ? { finishedItemId: filters.finishedItemId }
        : {})
    };
    const [costing, runs] = await Promise.all([
      getProductCosting(db, {
        from: period.fromDate,
        to: period.toDate,
        ...(filters.finishedItemId !== undefined
          ? { finishedItemId: filters.finishedItemId }
          : {})
      }),
      db.productionRun.findMany({
        where,
        orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
        take: 50001,
        select: {
          runNo: true,
          completedAt: true,
          actualGoodQty: true,
          materialCostPaise: true,
          overheadCostPaise: true,
          costPerPacketPaise: true,
          finishedItem: {
            select: { name: true, sellingPricePaise: true }
          }
        }
      })
    ]);

    if (runs.length > 50000 || costing.products.length > 50000) {
      throw new AppError(422, 'TOO_MANY_ROWS', 'Product costing sections cannot exceed 50000 rows');
    }

    const products = costing.products.map((product) => ({
      productCode: product.code,
      productName: product.name,
      runs: safeInteger(product.runCount, 'Product run count'),
      goodQty: safeInteger(product.goodQty, 'Good quantity'),
      materialCostPaise: safeInteger(product.materialCostPaise, 'Material cost'),
      overheadCostPaise: safeInteger(product.overheadCostPaise, 'Overhead cost'),
      totalCostPaise: safeInteger(product.totalCostPaise, 'Total cost'),
      avgCostPerPacketPaise: product.avgCostPerPacketPaise,
      sellingPricePaise: product.sellingPricePaise,
      marginPerPacketPaise: product.margin?.perPacketPaise ?? null,
      marginPctBp: product.margin?.bp ?? null
    }));

    const runRows = runs.map((run) => {
      const goodQty = safeInteger(run.actualGoodQty ?? 0, 'Good quantity');
      const materialCostPaise = safeInteger(run.materialCostPaise ?? 0, 'Material cost');
      const overheadCostPaise = safeInteger(run.overheadCostPaise ?? 0, 'Overhead cost');
      const totalCostPaise = safeInteger(
        materialCostPaise + overheadCostPaise,
        'Total run cost'
      );
      const costPerPacketPaise = run.costPerPacketPaise?.toString() ?? null;
      return {
        runNo: run.runNo,
        productName: run.finishedItem.name,
        completedDate: run.completedAt ? formatIstDate(run.completedAt) : null,
        goodQty,
        materialCostPaise,
        overheadCostPaise,
        totalCostPaise,
        costPerPacketPaise,
        marginPctBp: marginFor(
          run.finishedItem.sellingPricePaise,
          costPerPacketPaise
        ).marginPctBp
      };
    });

    return {
      title: 'Product Costing',
      period: { from: period.fromDate, to: period.toDate },
      sections: [
        makeSection({
          key: 'products',
          title: 'Product costing',
          columns: productColumns,
          rows: products
        }),
        makeSection({
          key: 'runs',
          title: 'Completed production runs',
          columns: runColumns,
          rows: runRows
        })
      ]
    };
  }
});

export default productCosting;
