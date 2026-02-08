with elections as (
    select * from {{ ref('stg_elections') }}
),

results as (
    select * from {{ ref('stg_national_results') }}
),

turnout as (
    select * from {{ ref('stg_prefecture_turnout') }}
),

results_agg as (
    select
        election_id,
        count(distinct party_id) as participating_parties,
        sum(total_votes) as total_votes_cast,
        sum(seats_won) as total_seats_filled,
        max(seats_won) as max_seats_by_party
    from results
    group by 1
),

winning_party as (
    select
        election_id,
        party_id as winning_party_id,
        seats_won as winning_party_seats,
        total_votes as winning_party_votes
    from (
        select
            *,
            row_number() over (partition by election_id order by seats_won desc, total_votes desc) as rn
        from results
    )
    where rn = 1
),

turnout_agg as (
    select
        election_id,
        sum(eligible_voters) as total_eligible_voters,
        sum(actual_voters) as total_actual_voters,
        round(
            cast(sum(actual_voters) as double)
            / cast(sum(eligible_voters) as double) * 100, 2
        ) as national_turnout_rate
    from turnout
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
        results_agg.participating_parties,
        results_agg.total_votes_cast,
        winning_party.winning_party_id,
        parties.party_name as winning_party_name,
        winning_party.winning_party_seats,
        round(
            cast(winning_party.winning_party_seats as double)
            / cast(elections.total_seats as double) * 100, 2
        ) as winning_party_seat_share,
        turnout_agg.total_eligible_voters,
        turnout_agg.total_actual_voters,
        turnout_agg.national_turnout_rate
    from elections
    left join results_agg on elections.election_id = results_agg.election_id
    left join winning_party on elections.election_id = winning_party.election_id
    left join {{ ref('stg_parties') }} as parties
        on winning_party.winning_party_id = parties.party_id
    left join turnout_agg on elections.election_id = turnout_agg.election_id
)

select * from joined
