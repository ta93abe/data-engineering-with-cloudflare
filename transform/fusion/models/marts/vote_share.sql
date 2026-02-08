with results as (
    select * from {{ ref('stg_national_results') }}
),

elections as (
    select * from {{ ref('stg_elections') }}
),

parties as (
    select * from {{ ref('stg_parties') }}
),

election_totals as (
    select
        election_id,
        sum(district_votes) as total_district_votes,
        sum(proportional_votes) as total_proportional_votes,
        sum(district_votes + proportional_votes) as total_all_votes
    from results
    group by 1
),

joined as (
    select
        elections.election_id,
        elections.election_name,
        elections.chamber,
        elections.chamber_name,
        elections.election_date,
        elections.total_seats,
        parties.party_id,
        parties.party_name,
        parties.party_abbreviation,
        results.district_votes,
        results.proportional_votes,
        results.total_votes,
        results.seats_won,
        round(
            cast(results.district_votes as double)
            / nullif(cast(election_totals.total_district_votes as double), 0) * 100, 2
        ) as district_vote_share,
        round(
            cast(results.proportional_votes as double)
            / nullif(cast(election_totals.total_proportional_votes as double), 0) * 100, 2
        ) as proportional_vote_share,
        round(
            cast(results.total_votes as double)
            / nullif(cast(election_totals.total_all_votes as double), 0) * 100, 2
        ) as total_vote_share,
        round(
            cast(results.seats_won as double)
            / cast(elections.total_seats as double) * 100, 2
        ) as seat_share,
        row_number() over (
            partition by results.election_id
            order by results.total_votes desc
        ) as vote_rank
    from results
    left join elections on results.election_id = elections.election_id
    left join parties on results.party_id = parties.party_id
    left join election_totals on results.election_id = election_totals.election_id
)

select * from joined
