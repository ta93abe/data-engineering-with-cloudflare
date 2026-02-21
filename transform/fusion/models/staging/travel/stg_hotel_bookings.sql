with source as (
    select * from {{ ref('raw_hotel_bookings') }}
),

renamed as (
    select
        hotel_booking_id,
        traveler_id,
        hotel_id,
        cast(check_in as date) as check_in,
        cast(check_out as date) as check_out,
        amount as hotel_amount
    from source
)

select * from renamed
