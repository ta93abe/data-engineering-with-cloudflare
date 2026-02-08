with source as (
    select * from {{ ref('raw_elections') }}
),

renamed as (
    select
        id as election_id,
        name as election_name,
        chamber,
        cast(election_date as date) as election_date,
        total_seats,
        case
            when chamber = 'lower' then '衆議院'
            when chamber = 'upper' then '参議院'
        end as chamber_name
    from source
)

select * from renamed
