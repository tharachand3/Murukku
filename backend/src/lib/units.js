import Decimal from 'decimal.js';

export const UNITS = Object.freeze({
  g: Object.freeze({ dimension: 'MASS', factor: 1 }),
  kg: Object.freeze({ dimension: 'MASS', factor: 1000 }),
  ml: Object.freeze({ dimension: 'VOLUME', factor: 1 }),
  l: Object.freeze({ dimension: 'VOLUME', factor: 1000 }),
  pcs: Object.freeze({ dimension: 'COUNT', factor: 1 }),
  packet: Object.freeze({ dimension: 'COUNT', factor: 1 })
});

function getUnit(unitCode) {
  if (typeof unitCode !== 'string' || !Object.hasOwn(UNITS, unitCode)) {
    throw new RangeError(`Unknown unit "${unitCode}".`);
  }
  return UNITS[unitCode];
}

function parseDecimal(value, name) {
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    !(value instanceof Decimal)
  ) {
    throw new TypeError(`${name} must be a decimal string, number, or Decimal`);
  }

  let decimal;
  try {
    decimal = new Decimal(value);
  } catch {
    throw new TypeError(`${name} must be a finite decimal value`);
  }
  if (!decimal.isFinite()) {
    throw new TypeError(`${name} must be a finite decimal value`);
  }
  return decimal;
}

function safeInteger(decimal, name) {
  if (
    !decimal.isInteger() ||
    decimal.abs().greaterThan(Number.MAX_SAFE_INTEGER)
  ) {
    throw new RangeError(`${name} must be a safe integer`);
  }
  return decimal.toNumber();
}

export function toBase(qty, unitCode) {
  const unit = getUnit(unitCode);
  const quantity = parseDecimal(qty, 'Quantity');
  return safeInteger(quantity.times(unit.factor), 'Base quantity');
}

export function fromBase(baseQty, unitCode) {
  const unit = getUnit(unitCode);
  if (!Number.isSafeInteger(baseQty)) {
    throw new RangeError('Base quantity must be a safe integer');
  }
  return new Decimal(baseQty).div(unit.factor);
}

export function formatQty(baseQty, unitCode) {
  return `${fromBase(baseQty, unitCode).toString()} ${unitCode}`;
}

export function convert(qty, fromUnit, toUnit) {
  const source = getUnit(fromUnit);
  const target = getUnit(toUnit);
  if (source.dimension !== target.dimension) {
    throw new RangeError(
      `Cannot convert ${fromUnit} (${source.dimension}) to ${toUnit} (${target.dimension})`
    );
  }

  return parseDecimal(qty, 'Quantity')
    .times(source.factor)
    .div(target.factor);
}

export function packetsToCartons(packets, packsPerCarton) {
  if (!Number.isSafeInteger(packets) || packets < 0) {
    throw new RangeError('Packets must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(packsPerCarton) || packsPerCarton <= 0) {
    throw new RangeError('Packs per carton must be a positive safe integer');
  }

  const packetCount = BigInt(packets);
  const cartonSize = BigInt(packsPerCarton);
  return {
    cartons: Number(packetCount / cartonSize),
    loosePackets: Number(packetCount % cartonSize)
  };
}
