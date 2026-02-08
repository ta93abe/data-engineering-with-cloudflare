with source as (
    select * from {{ ref('raw_prefecture_turnout') }}
),

renamed as (
    select
        election_id,
        prefecture_id,
        eligible_voters,
        actual_voters,
        round(cast(actual_voters as double) / cast(eligible_voters as double) * 100, 2) as turnout_rate
    from source
)

select * from renamed
