with destinations as (
    select * from {{ ref('stg_destinations') }}
)

select
    destination_id,
    city,
    country,
    region
from destinations
