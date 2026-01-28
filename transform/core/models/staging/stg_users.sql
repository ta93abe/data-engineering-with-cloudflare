with source as (
    select * from {{ ref('users') }}
),

renamed as (
    select
        user_id,
        username,
        email,
        country,
        cast(signup_date as date) as signup_date,
        is_premium,
        lifetime_value

    from source
)

select * from renamed
