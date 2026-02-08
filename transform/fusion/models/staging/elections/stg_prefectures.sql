with source as (
    select * from {{ ref('raw_prefectures') }}
),

renamed as (
    select
        id as prefecture_id,
        name as prefecture_name,
        region
    from source
)

select * from renamed
