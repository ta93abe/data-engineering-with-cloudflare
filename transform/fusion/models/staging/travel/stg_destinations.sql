with source as (
    select * from {{ ref('raw_destinations') }}
),

renamed as (
    select
        destination_id,
        city,
        country,
        region
    from source
)

select * from renamed
