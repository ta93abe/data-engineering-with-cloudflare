with source as (
    select * from {{ ref('products') }}
),

renamed as (
    select
        product_id,
        product_name,
        category,
        subcategory,
        price,
        cost,
        price - cost as margin,
        is_active

    from source
)

select * from renamed
