with fct_orders as (
    select * from {{ ref('fct_orders') }}
),

fct_order_items as (
    select * from {{ ref('fct_order_items') }}
),

daily_order_metrics as (
    select
        order_date,
        count(*) as total_orders,
        count(case when is_completed then 1 end) as completed_orders,
        count(case when is_cancelled then 1 end) as cancelled_orders,
        count(case when is_refunded then 1 end) as refunded_orders,
        count(distinct user_id) as unique_customers,
        sum(gross_amount) as gross_revenue,
        sum(discount_amount) as total_discounts,
        sum(net_amount) as net_revenue,
        sum(total_cost) as total_cost,
        sum(profit) as total_profit

    from fct_orders
    group by 1
),

daily_item_metrics as (
    select
        order_date,
        count(*) as total_items_sold,
        sum(quantity) as total_units_sold,
        count(distinct product_id) as unique_products_sold,
        count(distinct product_category) as unique_categories

    from fct_order_items
    where is_completed
    group by 1
),

final as (
    select
        -- Primary Key
        dom.order_date,

        -- Order Metrics
        dom.total_orders,
        dom.completed_orders,
        dom.cancelled_orders,
        dom.refunded_orders,
        dom.unique_customers,

        -- Item Metrics
        coalesce(dim.total_items_sold, 0) as total_items_sold,
        coalesce(dim.total_units_sold, 0) as total_units_sold,
        coalesce(dim.unique_products_sold, 0) as unique_products_sold,
        coalesce(dim.unique_categories, 0) as unique_categories,

        -- Revenue Metrics
        dom.gross_revenue,
        dom.total_discounts,
        dom.net_revenue,
        dom.total_cost,
        dom.total_profit,

        -- Calculated Metrics
        round(dom.net_revenue * 1.0 / nullif(dom.completed_orders, 0), 2) as avg_order_value,
        round(dom.total_profit * 100.0 / nullif(dom.net_revenue, 0), 2) as profit_margin_percent,

        -- Metadata
        current_timestamp as updated_at

    from daily_order_metrics dom
    left join daily_item_metrics dim on dom.order_date = dim.order_date
)

select * from final
order by order_date
