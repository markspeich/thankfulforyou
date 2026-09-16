alter table public.listing_drafts
  alter column amazon_production_details set default '{
    "packageLengthInches": 2,
    "packageWidthInches": 3,
    "packageHeightInches": 1,
    "packageWeightOunces": 1.1,
    "manufacturer": "Thankful For You",
    "partNumber": "TFY-010",
    "specialFeature": "Personalized",
    "closureType": "Clip"
  }'::jsonb;
