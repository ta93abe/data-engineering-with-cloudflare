{{ config(location='s3://data-lake/dbt/marts/fct_order_items.parquet') }}
with order_items as (
    select * from {{ ref('stg_order_items') }}
),

orders as (
    select * from {{ ref('stg_orders') }}
),

products as (
    select * from {{ ref('stg_products') }}
),

final as (
    select
        -- Primary Key
        oi.order_item_id,

        -- Foreign Keys (Dimensions)
        oi.order_id,
        o.user_id,
        oi.product_id,
        o.order_date,

        -- Order Context
        o.status as order_status,
        o.payment_method,
        o.shipping_country,

        -- Product Context
        p.category as product_category,
        p.subcategory as product_subcategory,

        -- Measures
        oi.quantity,
        oi.unit_price,
        oi.line_total as gross_amount,
        p.cost as unit_cost,
        p.cost * oi.quantity as total_cost,
        oi.line_total - (p.cost * oi.quantity) as profit,

        -- Profit Margin
        round((oi.line_total - (p.cost * oi.quantity)) * 100.0 / nullif(oi.line_total, 0), 2) as profit_margin_percent,

        -- Flags
        case when o.status = 'completed' then true else false end as is_completed,

        -- Metadata
        current_timestamp as updated_at

    from order_items oi
    inner join orders o on oi.order_id = o.order_id
    inner join products p on oi.product_id = p.product_id
)

select * from final
