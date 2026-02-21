with hotels as (
    select * from {{ ref('stg_hotels') }}
),

destinations as (
    select * from {{ ref('stg_destinations') }}
),

joined as (
    select
        hotels.hotel_id,
        hotels.hotel_name,
        hotels.destination_id,
        hotels.star_rating,
        destinations.city
    from hotels
    left join destinations
        on hotels.destination_id = destinations.destination_id
)

select * from joined
