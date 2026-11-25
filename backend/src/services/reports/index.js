export const reportDefs = [];

export function registerReport(definition) {
  if (reportDefs.some(({ key }) => key === definition.key)) {
    throw new Error(`Report already registered: ${definition.key}`);
  }
  reportDefs.push(definition);
  return definition;
}

export function getReport(key) {
  return reportDefs.find((definition) => definition.key === key);
}

// Append new reports below this line (import + registerReport). Never reorder.
import salesRegister from './salesRegister.js';
registerReport(salesRegister);
import salesByCustomer from './salesByCustomer.js';
registerReport(salesByCustomer);
import salesByProduct from './salesByProduct.js';
registerReport(salesByProduct);
import gstSummary from './gstSummary.js';
registerReport(gstSummary);
import stockSummary from './stockSummary.js';
registerReport(stockSummary);
import stockLedger from './stockLedger.js';
registerReport(stockLedger);
import purchaseRegister from './purchaseRegister.js';
registerReport(purchaseRegister);
import productionReport from './productionReport.js';
registerReport(productionReport);
