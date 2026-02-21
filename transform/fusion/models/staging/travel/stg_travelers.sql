with source as (
    select * from {{ ref('raw_travelers') }}
),

renamed as (
    select
        traveler_id,
        name as traveler_name,
        email,
        country
    from source
)

select * from renamed
