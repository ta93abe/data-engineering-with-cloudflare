{{
    config(
        materialized='view',
        tags=['staging', 'sample']
    )
}}

with source as (
    -- Placeholder: Replace with actual source reference
    -- select * from {{ source('raw', 'sample_data') }}
    select
        1 as id,
        'Sample Record' as name,
        current_timestamp as created_at
),

renamed as (
    select
        -- Primary Key
        cast(id as integer) as id,

        -- Attributes
        trim(name) as name,

        -- Metadata
        created_at,
        current_timestamp as _loaded_at

    from source
)

select * from renamed
