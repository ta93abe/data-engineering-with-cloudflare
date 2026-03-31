with orders as (
    select * from {{ ref('stg_orders') }}
),

order_items as (
    select * from {{ ref('stg_order_items') }}
),

products as (
    select * from {{ ref('stg_products') }}
),

order_totals as (
    select
        oi.order_id,
        count(*) as total_items,
        sum(oi.quantity) as total_quantity,
        sum(oi.line_total) as gross_amount,
        sum(p.cost * oi.quantity) as total_cost

    from order_items oi
    inner join products p on oi.product_id = p.product_id
    group by 1
),

final as (
    select
        -- Primary Key
        o.order_id,

        -- Foreign Keys (Dimensions)
        o.user_id,
        o.order_date,

        -- Order Attributes
        o.status,
        o.payment_method,
        o.shipping_country,

        -- Measures
        ot.total_items,
        ot.total_quantity,
        ot.gross_amount,
        o.discount_amount,
        ot.gross_amount - o.discount_amount as net_amount,
        ot.total_cost,
        ot.gross_amount - o.discount_amount - ot.total_cost as profit,

        -- Flags
        case when o.status = 'completed' then true else false end as is_completed,
        case when o.status = 'cancelled' then true else false end as is_cancelled,
        case when o.status = 'refunded' then true else false end as is_refunded,

        -- Metadata
        current_timestamp as updated_at

    from orders o
    inner join order_totals ot on o.order_id = ot.order_id
)

select * from final
