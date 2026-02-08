with source as (
    select * from {{ ref('raw_national_results') }}
),

renamed as (
    select
        election_id,
        party_id,
        district_votes,
        proportional_votes,
        district_votes + proportional_votes as total_votes,
        seats_won
    from source
)

select * from renamed
