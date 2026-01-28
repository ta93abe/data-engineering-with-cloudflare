with users as (
    select * from {{ ref('stg_users') }}
),

orders as (
    select * from {{ ref('stg_orders') }}
),

order_items as (
    select * from {{ ref('stg_order_items') }}
),

user_orders as (
    select
        o.user_id,
        count(distinct o.order_id) as total_orders,
        count(distinct case when o.status = 'completed' then o.order_id end) as completed_orders,
        min(o.order_date) as first_order_date,
        max(o.order_date) as last_order_date

    from orders o
    group by 1
),

user_revenue as (
    select
        o.user_id,
        sum(oi.line_total) as total_revenue,
        sum(case when o.status = 'completed' then oi.line_total else 0 end) as completed_revenue

    from orders o
    inner join order_items oi on o.order_id = oi.order_id
    group by 1
),

final as (
    select
        -- Primary Key
        u.user_id,

        -- User Attributes
        u.username,
        u.email,
        u.country,
        u.signup_date,
        u.is_premium,

        -- Calculated Metrics
        coalesce(uo.total_orders, 0) as total_orders,
        coalesce(uo.completed_orders, 0) as completed_orders,
        coalesce(ur.total_revenue, 0) as total_revenue,
        coalesce(ur.completed_revenue, 0) as completed_revenue,
        uo.first_order_date,
        uo.last_order_date,

        -- Customer Segmentation
        case
            when ur.completed_revenue >= 50000 then 'High Value'
            when ur.completed_revenue >= 20000 then 'Medium Value'
            when ur.completed_revenue > 0 then 'Low Value'
            else 'No Purchase'
        end as customer_segment,

        -- Metadata
        current_timestamp as updated_at

    from users u
    left join user_orders uo on u.user_id = uo.user_id
    left join user_revenue ur on u.user_id = ur.user_id
)

select * from final
