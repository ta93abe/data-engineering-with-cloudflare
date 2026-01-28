{{
    config(
        materialized='view',
        tags=['staging']
    )
}}

with source as (
    select * from {{ ref('orders') }}
),

renamed as (
    select
        order_id,
        user_id,
        cast(order_date as date) as order_date,
        status,
        payment_method,
        shipping_country,
        discount_amount

    from source
)

select * from renamed
