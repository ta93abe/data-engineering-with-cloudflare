with turnout as (
    select * from {{ ref('stg_prefecture_turnout') }}
),

elections as (
    select * from {{ ref('stg_elections') }}
),

prefectures as (
    select * from {{ ref('stg_prefectures') }}
),

national_avg as (
    select
        election_id,
        sum(actual_voters) as national_actual_voters,
        sum(eligible_voters) as national_eligible_voters,
        round(
            cast(sum(actual_voters) as double)
            / cast(sum(eligible_voters) as double) * 100, 2
        ) as national_turnout_rate
    from turnout
    group by 1
),

region_avg as (
    select
        turnout.election_id,
        prefectures.region,
        round(
            cast(sum(turnout.actual_voters) as double)
            / cast(sum(turnout.eligible_voters) as double) * 100, 2
        ) as region_turnout_rate
    from turnout
    left join prefectures on turnout.prefecture_id = prefectures.prefecture_id
    group by 1, 2
),

joined as (
    select
        elections.election_id,
        elections.election_name,
        elections.chamber,
        elections.chamber_name,
        elections.election_date,
        prefectures.prefecture_id,
        prefectures.prefecture_name,
        prefectures.region,
        turnout.eligible_voters,
        turnout.actual_voters,
        turnout.turnout_rate,
        national_avg.national_turnout_rate,
        region_avg.region_turnout_rate,
        round(turnout.turnout_rate - national_avg.national_turnout_rate, 2) as diff_from_national,
        row_number() over (
            partition by turnout.election_id
            order by turnout.turnout_rate desc
        ) as turnout_rank
    from turnout
    left join elections on turnout.election_id = elections.election_id
    left join prefectures on turnout.prefecture_id = prefectures.prefecture_id
    left join national_avg on turnout.election_id = national_avg.election_id
    left join region_avg
        on turnout.election_id = region_avg.election_id
        and prefectures.region = region_avg.region
)

select * from joined
