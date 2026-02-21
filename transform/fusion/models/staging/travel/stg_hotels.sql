with source as (
    select * from {{ ref('raw_hotels') }}
),

renamed as (
    select
        hotel_id,
        hotel_name,
        destination_id,
        star_rating
    from source
)

select * from renamed
