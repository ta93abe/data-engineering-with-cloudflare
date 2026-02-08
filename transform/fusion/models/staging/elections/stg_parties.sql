with source as (
    select * from {{ ref('raw_parties') }}
),

renamed as (
    select
        id as party_id,
        name as party_name,
        abbreviation as party_abbreviation,
        founded_year
    from source
)

select * from renamed
