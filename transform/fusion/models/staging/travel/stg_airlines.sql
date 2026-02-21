with source as (
    select * from {{ ref('raw_airlines') }}
),

renamed as (
    select
        airline_id,
        airline_name,
        alliance
    from source
)

select * from renamed
