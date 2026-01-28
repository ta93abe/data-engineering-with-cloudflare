{{
    config(
        materialized='table',
        tags=['marts', 'core', 'dimension']
    )
}}

with staged as (
    select * from {{ ref('stg_sample') }}
),

final as (
    select
        -- Primary Key
        id as sample_id,

        -- Attributes
        name as sample_name,

        -- Timestamps
        created_at,
        _loaded_at as updated_at

    from staged
)

select * from final
