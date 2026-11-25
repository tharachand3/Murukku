# Data Model

```mermaid
erDiagram
    User o|--o{ Customer : "assigned salesman"
    Unit ||--o{ Item : "base unit"
    Unit ||--o{ Item : "display unit"
    Customer ||--o{ CustomerPrice : "has prices"
    Item ||--o{ CustomerPrice : "priced for"

    User {
        int id PK
        string name
        string email UK
        string passwordHash
        Role role
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }

    Unit {
        int id PK
        string code UK
        string name
        UnitDimension dimension
        int baseFactor
    }

    Item {
        int id PK
        string code UK
        string name
        ItemType type
        int baseUnitId FK
        int displayUnitId FK
        string hsnCode
        int gstRateBp
        int packsPerCarton
        int sellingPricePaise
        int reorderLevelBase
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }

    Customer {
        int id PK
        string name
        CustomerType type
        string gstin
        string stateCode
        string stateName
        string address
        string phone
        int assignedSalesmanId FK
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }

    Supplier {
        int id PK
        string name
        string gstin
        string stateCode
        string phone
        string address
        boolean isActive
        datetime createdAt
    }

    CustomerPrice {
        int id PK
        int customerId FK
        int itemId FK
        int pricePaise
    }

    Setting {
        string key PK
        string value
        datetime updatedAt
    }

    Item ||--o{ Bom : "finished item"
    Bom ||--o{ BomLine : "contains"
    Item ||--o{ BomLine : "ingredient"
    Supplier ||--o{ Purchase : "supplies"
    User ||--o{ Purchase : "records"
    Purchase ||--o{ PurchaseLine : "contains"
    Item ||--o{ PurchaseLine : "purchased"
    Bom ||--o{ ProductionRun : "used for"
    Item ||--o{ ProductionRun : "finished item"
    User ||--o{ ProductionRun : "starts"
    User o|--o{ ProductionRun : "completes"
    ProductionRun ||--o{ ProductionRunLine : "issues"
    Item ||--o{ ProductionRunLine : "material"
    ProductionRun ||--o{ ProductionOverhead : "incurs"
    Item ||--o{ StockMovement : "moves"
    User o|--o{ StockMovement : "records"
    Item ||--o{ StockAdjustment : "adjusted by"
    User ||--o{ StockAdjustment : "records"
    User o|--o{ AuditLog : "performs"
    Customer ||--o{ Order : "places"
    User ||--o{ Order : "salesman"
    User o|--o{ Order : "approves"
    Order ||--o{ OrderLine : "contains"
    Item ||--o{ OrderLine : "ordered"
    Order o|--o| Invoice : "invoiced as"
    Customer ||--o{ Invoice : "billed"
    User ||--o{ Invoice : "creates"
    Invoice ||--o{ InvoiceLine : "snapshots"
    Item ||--o{ InvoiceLine : "invoiced"
    Invoice ||--o{ Dispatch : "dispatched"
    User ||--o{ Dispatch : "records"
    Dispatch ||--o{ DispatchLine : "contains"
    Item ||--o{ DispatchLine : "shipped"
    Customer ||--o{ Payment : "pays"
    Invoice o|--o{ Payment : "settles"
    User ||--o{ Payment : "records"
    Invoice ||--o{ CreditNote : "credited by"
    User ||--o{ CreditNote : "creates"

    Bom {
        int id PK
        string name
        int finishedItemId FK
        int version
        boolean isActive
        int batchYieldQty
        string notes
        datetime createdAt
        datetime updatedAt
    }

    BomLine {
        int id PK
        int bomId FK
        int itemId FK
        int qtyPerBatch
    }

    Purchase {
        int id PK
        string number UK
        int supplierId FK
        datetime purchaseDate
        string supplierInvoiceNo
        int totalPaise
        string notes
        int createdById FK
        datetime createdAt
    }

    PurchaseLine {
        int id PK
        int purchaseId FK
        int itemId FK
        int qty
        decimal ratePaisePerBase
        int amountPaise
        string batchNo
        datetime expiryDate
    }

    ProductionRun {
        int id PK
        string runNo UK
        int bomId FK
        int finishedItemId FK
        RunStatus status
        decimal batchCount
        int plannedOutputQty
        int actualGoodQty
        int rejectedFinishedQty
        int yieldVarianceBp
        boolean yieldFlagged
        int toleranceBpUsed
        int materialCostPaise
        int overheadCostPaise
        decimal costPerPacketPaise
        string batchNo
        datetime startedAt
        datetime completedAt
        int startedById FK
        int completedById FK
        string notes
    }

    ProductionRunLine {
        int id PK
        int runId FK
        int itemId FK
        int plannedQty
        int issuedQty
        int scrapQty
        int varianceBp
        boolean flagged
        decimal ratePaisePerBase
        int costPaise
    }

    ProductionOverhead {
        int id PK
        int runId FK
        OverheadKind kind
        int amountPaise
        string note
    }

    StockMovement {
        int id PK
        int itemId FK
        MovementType movementType
        int qtyChange
        decimal ratePaisePerBase
        int valuePaise
        SourceType sourceType
        int sourceId
        string sourceRef
        string batchNo
        datetime expiryDate
        datetime movementDate
        string note
        int createdById FK
        datetime createdAt
    }

    StockAdjustment {
        int id PK
        string number UK
        int itemId FK
        int qtyChange
        string reason
        string note
        int createdById FK
        datetime createdAt
    }

    AuditLog {
        int id PK
        int userId FK
        string action
        string entity
        int entityId
        json before
        json after
        datetime createdAt
    }

    Order {
        int id PK
        string orderNo UK
        string clientRef UK
        int customerId FK
        int salesmanId FK
        OrderStatus status
        string notes
        string rejectReason
        datetime createdAt
        int approvedById FK
        datetime approvedAt
        datetime updatedAt
    }

    OrderLine {
        int id PK
        int orderId FK
        int itemId FK
        int qty
        int pricePaise
        int approvedQty
        int approvedPricePaise
    }

    Invoice {
        int id PK
        string invoiceNo UK
        string financialYear
        int orderId FK, UK
        int customerId FK
        datetime issueDate
        string placeOfSupplyStateCode
        boolean isInterState
        int taxableValuePaise
        int cgstPaise
        int sgstPaise
        int igstPaise
        int totalPaise
        InvoiceStatus status
        datetime cancelledAt
        string cancelReason
        int createdById FK
        datetime createdAt
        json snapshot
    }

    InvoiceLine {
        int id PK
        int invoiceId FK
        int itemId FK
        string description
        string hsnCode
        int qty
        int ratePaise
        int taxableValuePaise
        int gstRateBp
        int cgstPaise
        int sgstPaise
        int igstPaise
        int totalPaise
    }

    Dispatch {
        int id PK
        string dispatchNo UK
        int invoiceId FK
        datetime dispatchDate
        string vehicleNo
        string notes
        int createdById FK
    }

    DispatchLine {
        int id PK
        int dispatchId FK
        int itemId FK
        int qty
    }

    Payment {
        int id PK
        string receiptNo UK
        int customerId FK
        int invoiceId FK
        int amountPaise
        PaymentMode mode
        string reference
        datetime paymentDate
        string notes
        int createdById FK
        datetime createdAt
    }

    CreditNote {
        int id PK
        string noteNo UK
        int invoiceId FK
        string reason
        int taxableValuePaise
        int cgstPaise
        int sgstPaise
        int igstPaise
        int totalPaise
        int createdById FK
        datetime createdAt
    }

    DocumentCounter {
        string key PK
        int lastNumber
    }
```

## Production run cost allocation

All overheads for a run are charged fully to that run; each run produces one finished product.
Total run cost in paise = `materialCostPaise + overheadCostPaise`.
Cost per good packet = total run cost / `actualGoodQty`, rounded half-up to four decimal places.
Scrap and damaged packets carry cost but are excluded from the good-quantity divisor.
Overhead entries do not create stock movements; deletions retain an audit record.

Money is stored as integer paise to avoid floating-point rounding in financial values.
List prices and customer-specific prices use the same integer-paise representation.
Quantities are stored as integer base units such as grams, millilitres, pieces, or packets.
`Unit.baseFactor` converts displayed units to integer base units at the system boundary.
This keeps inventory arithmetic and financial totals deterministic and auditable.

Stock = sum of ledger rows; production run writes ISSUE rows (raw down) and OUTPUT row (finished up).
Each stock movement records a signed quantity in the item's integer base unit.
The movement source identifies the originating business document for traceability.
Stock movements are append-only: a PostgreSQL trigger rejects UPDATE and DELETE; corrections use a new ADJUSTMENT movement.
Each adjustment has a numbered source record so its append-only ledger row is traceable.
A bill of materials records the ingredients and base-unit quantities for one batch.
Purchases and production runs retain their line-level quantities, rates, and costs.
Audit logs capture who changed an entity and the recorded before-and-after values.

## Sales model notes

- Invoice lines snapshot their rate, HSN code, and GST rate so later master-data changes do not alter posted invoices.
- Cancelling an invoice creates a credit note; invoices are never deleted.
- The invoice snapshot stores seller, buyer, and originating order details as JSON. Database triggers prevent invoice and invoice-line deletion, prevent invoice-line updates, and restrict invoice updates to cancellation fields until cancelled.
