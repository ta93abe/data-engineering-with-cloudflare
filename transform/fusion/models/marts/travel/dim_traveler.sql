with travelers as (
    select * from {{ ref('stg_travelers') }}
)

select
    traveler_id,
    traveler_name,
    email,
    country
from travelers
