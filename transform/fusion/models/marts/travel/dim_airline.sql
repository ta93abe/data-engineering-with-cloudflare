with airlines as (
    select * from {{ ref('stg_airlines') }}
)

select
    airline_id,
    airline_name,
    alliance
from airlines
