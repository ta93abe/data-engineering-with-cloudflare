{{
    config(
        materialized='table',
        tags=['marts', 'dimension']
    )
}}

with products as (
    select * from {{ ref('stg_products') }}
),

order_items as (
    select * from {{ ref('stg_order_items') }}
),

orders as (
    select * from {{ ref('stg_orders') }}
),

product_sales as (
    select
        oi.product_id,
        count(distinct oi.order_id) as total_orders,
        count(distinct case when o.status = 'completed' then oi.order_id end) as completed_orders,
        sum(oi.quantity) as total_quantity_sold,
        sum(case when o.status = 'completed' then oi.quantity else 0 end) as completed_quantity_sold,
        sum(oi.line_total) as total_revenue,
        sum(case when o.status = 'completed' then oi.line_total else 0 end) as completed_revenue

    from order_items oi
    inner join orders o on oi.order_id = o.order_id
    group by 1
),

final as (
    select
        -- Primary Key
        p.product_id,

        -- Product Attributes
        p.product_name,
        p.category,
        p.subcategory,
        p.price,
        p.cost,
        p.margin,
        round(p.margin * 100.0 / nullif(p.price, 0), 2) as margin_percent,
        p.is_active,

        -- Sales Metrics
        coalesce(ps.total_orders, 0) as total_orders,
        coalesce(ps.completed_orders, 0) as completed_orders,
        coalesce(ps.total_quantity_sold, 0) as total_quantity_sold,
        coalesce(ps.completed_quantity_sold, 0) as completed_quantity_sold,
        coalesce(ps.total_revenue, 0) as total_revenue,
        coalesce(ps.completed_revenue, 0) as completed_revenue,

        -- Product Performance
        case
            when ps.completed_revenue >= 30000 then 'Top Performer'
            when ps.completed_revenue >= 10000 then 'Good Performer'
            when ps.completed_revenue > 0 then 'Low Performer'
            else 'No Sales'
        end as performance_tier,

        -- Metadata
        current_timestamp as updated_at

    from products p
    left join product_sales ps on p.product_id = ps.product_id
)

select * from final
