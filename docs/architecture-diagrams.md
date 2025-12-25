# アーキテクチャ図

本ドキュメントでは、Cloudflareデータ基盤のアーキテクチャをMermaid図で可視化します。

## 目次

- [全体アーキテクチャ](#全体アーキテクチャ)
- [データフロー詳細](#データフロー詳細)
- [ETLパイプライン](#etlパイプライン)
- [リアルタイム処理](#リアルタイム処理)
- [CI/CDパイプライン](#cicdパイプライン)

---

## 全体アーキテクチャ

```mermaid
graph TB
    subgraph "Data Sources"
        API[External APIs]
        DB[(External Databases)]
        Events[User Events]
        Files[File Uploads]
    end

    subgraph "Ingestion Layer"
        dlt[dlt<br/>Python ETL]
        Workers[Cloudflare Workers<br/>Edge Compute]
        Pipelines[Cloudflare Pipelines<br/>Streaming ETL]
    end

    subgraph "Orchestration"
        GHA[GitHub Actions<br/>Scheduled Jobs]
        Workflows[Cloudflare Workflows<br/>Durable Execution]
    end

    subgraph "Storage Layer"
        R2[(Cloudflare R2<br/>Object Storage)]
        D1[(Cloudflare D1<br/>SQLite)]
        KV[(Cloudflare KV<br/>Key-Value)]
        Iceberg[Apache Iceberg<br/>Table Format]
    end

    subgraph "Transformation Layer"
        dbt[dbt<br/>SQL Transformations]
        DuckDB[DuckDB<br/>Analytics Engine]
        WorkersT[Workers<br/>Real-time Transform]
    end

    subgraph "Analytics & Visualization"
        R2SQL[R2 SQL<br/>Query Engine]
        AnalyticsEngine[Analytics Engine<br/>Time-series DB]
        Evidence[Evidence.dev<br/>BI Dashboard]
        Pages[Cloudflare Pages<br/>Static Hosting]
    end

    subgraph "Monitoring & Alerts"
        Slack[Slack<br/>Notifications]
    end

    %% Data Flow
    API --> dlt
    DB --> dlt
    Events --> Workers
    Events --> Pipelines
    Files --> Workers

    dlt --> R2
    Workers --> D1
    Workers --> KV
    Workers --> AnalyticsEngine
    Pipelines --> R2

    R2 --> Iceberg
    Iceberg --> R2

    GHA --> dlt
    GHA --> dbt
    Workflows --> WorkersT

    R2 --> DuckDB
    D1 --> DuckDB
    DuckDB --> dbt

    dbt --> R2
    dbt --> D1

    R2 --> R2SQL
    R2 --> Evidence
    D1 --> Evidence
    AnalyticsEngine --> Evidence

    Evidence --> Pages

    Workers --> Slack
    Workflows --> Slack
    GHA --> Slack
    Evidence --> Slack

    style Workers fill:#f96,stroke:#333,stroke-width:2px
    style R2 fill:#6cf,stroke:#333,stroke-width:2px
    style Evidence fill:#9f6,stroke:#333,stroke-width:2px
    style Iceberg fill:#fc6,stroke:#333,stroke-width:2px
```

---

## データフロー詳細

### レイヤー別データフロー

```mermaid
graph LR
    subgraph "Layer 1: Ingestion"
        I1[HTTP APIs]
        I2[WebSocket Events]
        I3[File Uploads]
        I4[Database CDC]
    end

    subgraph "Layer 2: Processing"
        P1[Workers<br/>Real-time]
        P2[Pipelines<br/>Stream]
        P3[dlt<br/>Batch]
    end

    subgraph "Layer 3: Raw Storage"
        S1[R2 Raw<br/>Parquet/JSON]
        S2[D1 Raw<br/>SQLite Tables]
        S3[KV Cache<br/>Hot Data]
    end

    subgraph "Layer 4: Transformation"
        T1[dbt Models<br/>SQL]
        T2[DuckDB<br/>In-memory]
        T3[Workers<br/>JavaScript/Python]
    end

    subgraph "Layer 5: Curated Storage"
        C1[R2 Iceberg<br/>Marts]
        C2[D1 Marts<br/>Aggregates]
        C3[Analytics Engine<br/>Metrics]
    end

    subgraph "Layer 6: Consumption"
        U1[Evidence<br/>Dashboards]
        U2[R2 SQL<br/>Ad-hoc Query]
        U3[API<br/>Endpoints]
    end

    I1 --> P1
    I2 --> P1
    I2 --> P2
    I3 --> P1
    I4 --> P3

    P1 --> S2
    P1 --> S3
    P1 --> C3
    P2 --> S1
    P3 --> S1

    S1 --> T1
    S1 --> T2
    S2 --> T1

    T1 --> C1
    T1 --> C2
    T2 --> C1

    C1 --> U1
    C1 --> U2
    C2 --> U1
    C2 --> U3
    C3 --> U1

    style P1 fill:#f96
    style C1 fill:#fc6
    style U1 fill:#9f6
```

---

## ETLパイプライン

### バッチETLワークフロー

```mermaid
graph TB
    subgraph "GitHub Actions Trigger"
        Schedule[Cron Schedule<br/>Every 6 hours]
        Manual[Manual Trigger<br/>workflow_dispatch]
    end

    subgraph "Extraction Job"
        E1[dlt Pipeline Start]
        E2[Fetch from APIs]
        E3[Schema Inference]
        E4[Write to R2 Raw]
        E5[State Management]
    end

    subgraph "Transformation Job"
        T1[dbt Run Start]
        T2[Load R2 Data<br/>via DuckDB]
        T3[Run Staging Models]
        T4[Run Intermediate Models]
        T5[Run Mart Models]
        T6[Write to R2 Iceberg]
        T7[Run dbt Tests]
    end

    subgraph "Quality Checks"
        Q1[Data Freshness Check]
        Q2[Row Count Validation]
        Q3[Schema Validation]
        Q4[Null Check]
    end

    subgraph "Deployment"
        D1[Build Evidence]
        D2[Deploy to Pages]
        D3[Invalidate Cache]
    end

    subgraph "Notification"
        N1{Success?}
        N2[Slack Success Message]
        N3[Slack Error Alert]
    end

    Schedule --> E1
    Manual --> E1

    E1 --> E2
    E2 --> E3
    E3 --> E4
    E4 --> E5

    E5 --> T1
    T1 --> T2
    T2 --> T3
    T3 --> T4
    T4 --> T5
    T5 --> T6
    T6 --> T7

    T7 --> Q1
    Q1 --> Q2
    Q2 --> Q3
    Q3 --> Q4

    Q4 --> D1
    D1 --> D2
    D2 --> D3

    D3 --> N1
    N1 -->|Yes| N2
    N1 -->|No| N3

    style E1 fill:#6cf
    style T1 fill:#9cf
    style Q1 fill:#fc6
    style D1 fill:#9f6
    style N3 fill:#f66
```

---

## リアルタイム処理

### イベント駆動アーキテクチャ

```mermaid
graph TB
    subgraph "Event Sources"
        User[User Action]
        System[System Event]
        External[External Webhook]
    end

    subgraph "Edge Processing"
        Worker[Cloudflare Worker]
        Validation[Data Validation]
        Enrichment[Data Enrichment]
    end

    subgraph "Routing"
        Router{Event Type}
    end

    subgraph "Real-time Targets"
        RT1[Analytics Engine<br/>Write Metrics]
        RT2[D1<br/>Transactional Data]
        RT3[KV<br/>Cache Update]
    end

    subgraph "Async Processing"
        Queue[Cloudflare Queue]
        Consumer[Consumer Worker]
    end

    subgraph "Stream Processing"
        Pipeline[Cloudflare Pipeline]
        Transform[SQL Transform]
        Sink[R2 Iceberg Sink]
    end

    subgraph "Durable Workflows"
        WF[Workflow Instance]
        Step1[Step 1: Process]
        Step2[Step 2: Validate]
        Step3[Step 3: Store]
        Step4[Step 4: Notify]
    end

    User --> Worker
    System --> Worker
    External --> Worker

    Worker --> Validation
    Validation --> Enrichment
    Enrichment --> Router

    Router -->|Metric| RT1
    Router -->|Transaction| RT2
    Router -->|Cache| RT3
    Router -->|Async| Queue
    Router -->|Stream| Pipeline
    Router -->|Complex| WF

    Queue --> Consumer
    Consumer --> RT2

    Pipeline --> Transform
    Transform --> Sink

    WF --> Step1
    Step1 --> Step2
    Step2 --> Step3
    Step3 --> Step4

    Step4 --> Slack[Slack Notification]

    style Worker fill:#f96
    style Router fill:#fc6
    style WF fill:#9cf
```

---

## CI/CDパイプライン

### 開発・デプロイフロー

```mermaid
graph TB
    subgraph "Development"
        Dev[Developer]
        LocalTest[Local Testing<br/>DuckDB + Miniflare]
        Commit[Git Commit]
    end

    subgraph "Version Control"
        PR[Pull Request]
        Review[Code Review]
        Merge[Merge to Main]
    end

    subgraph "CI Pipeline"
        CI1[Run Tests]
        CI2[Run dbt Tests]
        CI3[Lint Code]
        CI4[Security Scan]
    end

    subgraph "CD Pipeline - Workers"
        CD1[Build Workers]
        CD2[Deploy to Dev]
        CD3{Tests Pass?}
        CD4[Deploy to Prod]
    end

    subgraph "CD Pipeline - dbt"
        DBT1[Install Dependencies]
        DBT2[Run dbt Models]
        DBT3[Generate Docs]
        DBT4[Upload Artifacts]
    end

    subgraph "CD Pipeline - Evidence"
        EV1[Build Evidence]
        EV2[Deploy to Pages]
        EV3[Invalidate CDN]
    end

    subgraph "Monitoring"
        M1[Deployment Status]
        M2[Health Checks]
        M3[Error Tracking]
    end

    subgraph "Notifications"
        S1[Slack Channel]
        S2[Email Alerts]
    end

    Dev --> LocalTest
    LocalTest --> Commit
    Commit --> PR
    PR --> Review
    Review --> Merge

    Merge --> CI1
    CI1 --> CI2
    CI2 --> CI3
    CI3 --> CI4

    CI4 --> CD1
    CD1 --> CD2
    CD2 --> CD3
    CD3 -->|Yes| CD4

    CI4 --> DBT1
    DBT1 --> DBT2
    DBT2 --> DBT3
    DBT3 --> DBT4

    CI4 --> EV1
    EV1 --> EV2
    EV2 --> EV3

    CD4 --> M1
    DBT4 --> M1
    EV3 --> M1

    M1 --> M2
    M2 --> M3

    M3 --> S1
    M3 --> S2

    style Merge fill:#6cf
    style CD4 fill:#9f6
    style M3 fill:#fc6
    style S1 fill:#f96
```

---

## データストレージ戦略

### ストレージレイヤーの使い分け

```mermaid
graph TB
    subgraph "Hot Path - Low Latency"
        H1[Workers KV<br/>< 1ms read]
        H2[D1 SQLite<br/>< 10ms query]
        H3[Analytics Engine<br/>Real-time metrics]
    end

    subgraph "Warm Path - Moderate Latency"
        W1[D1 Replicas<br/>Read scaling]
        W2[Durable Objects<br/>Stateful]
    end

    subgraph "Cold Path - High Throughput"
        C1[R2 Parquet<br/>Columnar format]
        C2[R2 Iceberg<br/>ACID tables]
        C3[R2 Archives<br/>Long-term storage]
    end

    subgraph "Use Cases"
        UC1[Session Data]
        UC2[User Profiles]
        UC3[Event Logs]
        UC4[Analytics Data]
        UC5[Historical Data]
    end

    subgraph "Access Patterns"
        AP1[Point Lookup]
        AP2[Range Query]
        AP3[Full Scan]
        AP4[Aggregation]
    end

    UC1 --> H1
    UC2 --> H2
    UC3 --> H3
    UC4 --> C2
    UC5 --> C3

    AP1 --> H1
    AP1 --> H2
    AP2 --> W1
    AP3 --> C1
    AP4 --> C2

    H1 -.Promote.-> H2
    H2 -.Archive.-> C1
    C1 -.Optimize.-> C2

    style H1 fill:#f66
    style H2 fill:#f96
    style C2 fill:#6cf
```

---

## セキュリティ・認証フロー

```mermaid
graph TB
    subgraph "Secrets Management"
        GHS[GitHub Secrets]
        CFV[Cloudflare Secrets<br/>wrangler secret]
        SS[Secrets Store<br/>Beta]
    end

    subgraph "Authentication"
        A1[API Token<br/>Cloudflare]
        A2[Service Binding<br/>Workers-to-Workers]
        A3[R2 Credentials<br/>S3-compatible]
    end

    subgraph "Authorization"
        Z1[WAF Rules]
        Z2[Access Policies]
        Z3[Worker Bindings]
    end

    subgraph "Data Security"
        DS1[Encryption at Rest<br/>R2/D1]
        DS2[TLS in Transit]
        DS3[Data Masking<br/>PII]
    end

    subgraph "Audit & Compliance"
        AC1[Access Logs]
        AC2[Audit Trail<br/>Analytics Engine]
        AC3[Compliance Reports]
    end

    GHS --> A1
    GHS --> A3
    CFV --> A1
    SS --> A1

    A1 --> Z1
    A2 --> Z3
    A3 --> Z2

    Z1 --> DS1
    Z2 --> DS2
    Z3 --> DS3

    DS1 --> AC1
    DS2 --> AC2
    DS3 --> AC3

    AC3 --> Slack[Slack Security<br/>Notifications]

    style SS fill:#fc6
    style DS1 fill:#9f6
    style AC3 fill:#6cf
```

---

## スケーリング戦略

```mermaid
graph LR
    subgraph "Traffic Growth"
        T1[1K req/sec]
        T2[10K req/sec]
        T3[100K req/sec]
    end

    subgraph "Compute Scaling"
        C1[Workers<br/>Auto-scale]
        C2[Workflows<br/>Durable]
        C3[Containers<br/>Future]
    end

    subgraph "Storage Scaling"
        S1[KV: Cache Layer]
        S2[D1: Read Replicas]
        S3[R2: Unlimited]
    end

    subgraph "Processing Scaling"
        P1[Queues: Buffer]
        P2[Pipelines: Stream]
        P3[Batch: Scheduled]
    end

    subgraph "Optimization"
        O1[Edge Caching]
        O2[Partitioning]
        O3[Compression]
    end

    T1 --> C1
    T1 --> S1

    T2 --> C1
    T2 --> C2
    T2 --> S2
    T2 --> P1

    T3 --> C1
    T3 --> C2
    T3 --> C3
    T3 --> S3
    T3 --> P2

    C1 --> O1
    S3 --> O2
    S3 --> O3

    style C1 fill:#9f6
    style S3 fill:#6cf
    style O1 fill:#fc6
```

---

## コスト最適化

```mermaid
graph TB
    subgraph "Cost Drivers"
        CD1[Workers Requests]
        CD2[D1 Storage & I/O]
        CD3[R2 Storage & Operations]
        CD4[KV Writes]
    end

    subgraph "Optimization Strategies"
        OS1[Cache Aggressively<br/>KV for reads]
        OS2[Batch Operations<br/>Reduce request count]
        OS3[Use R2 for Archives<br/>No egress fees]
        OS4[Incremental dbt<br/>Process only new data]
    end

    subgraph "Monitoring"
        M1[Track Daily Costs]
        M2[Set Budget Alerts]
        M3[Usage Analytics]
    end

    subgraph "Cost Savings"
        CS1[Free Tier Usage]
        CS2[Reduced Latency]
        CS3[Lower Data Transfer]
    end

    CD1 --> OS1
    CD1 --> OS2
    CD2 --> OS4
    CD3 --> OS3
    CD4 --> OS1

    OS1 --> M1
    OS2 --> M1
    OS3 --> M1
    OS4 --> M1

    M1 --> M2
    M2 --> M3

    M3 --> CS1
    M3 --> CS2
    M3 --> CS3

    CS3 --> Slack[Slack Cost<br/>Reports]

    style OS3 fill:#9f6
    style CS3 fill:#6cf
```

---

## まとめ

本ドキュメントでは、以下のアーキテクチャ図を提供しました：

1. **全体アーキテクチャ**: Cloudflareデータ基盤の全体像
2. **データフロー詳細**: レイヤー別のデータフロー
3. **ETLパイプライン**: バッチ処理ワークフロー
4. **リアルタイム処理**: イベント駆動アーキテクチャ
5. **CI/CDパイプライン**: 開発・デプロイフロー
6. **ストレージ戦略**: Hot/Warm/Coldパスの使い分け
7. **セキュリティフロー**: 認証・認可・監査
8. **スケーリング戦略**: トラフィック増加への対応
9. **コスト最適化**: コスト削減戦略

これらの図は、GitHubやConfluenceなどでMermaidをサポートする環境で自動レンダリングされます。

---

最終更新: 2025年12月25日
