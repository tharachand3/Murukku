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
```

Money is stored as integer paise to avoid floating-point rounding in financial values.
List prices and customer-specific prices use the same integer-paise representation.
Quantities are stored as integer base units such as grams, millilitres, pieces, or packets.
`Unit.baseFactor` converts displayed units to integer base units at the system boundary.
This keeps inventory arithmetic and financial totals deterministic and auditable.
