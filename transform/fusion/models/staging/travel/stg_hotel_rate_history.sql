with source as (
    select * from {{ ref('raw_hotel_rate_history') }}
),

renamed as (
    select
        rate_id,
        hotel_id,
        cast(effective_date as date) as effective_date,
        rate_per_night
    from source
)

select * from renamed
