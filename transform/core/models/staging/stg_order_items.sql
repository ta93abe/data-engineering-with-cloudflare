{{
    config(
        materialized='view',
        tags=['staging']
    )
}}

with source as (
    select * from {{ ref('order_items') }}
),

renamed as (
    select
        order_item_id,
        order_id,
        product_id,
        quantity,
        unit_price,
        quantity * unit_price as line_total

    from source
)

select * from renamed
