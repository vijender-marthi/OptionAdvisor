import unittest


class OptionChainApiContractTests(unittest.TestCase):
    def test_option_chain_endpoint_is_exposed_in_openapi_contract(self) -> None:
        import main

        schema = main.app.openapi()
        response = schema["paths"]["/api/option-chain/{ticker}"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
        self.assertEqual(response["$ref"], "#/components/schemas/OptionChainLiquidityResponse")

        schemas = schema["components"]["schemas"]
        self.assertIn("OptionChainLiquidityResponse", schemas)
        self.assertIn("OptionChainLiquidityRow", schemas)

        chain_schema = schemas["OptionChainLiquidityResponse"]
        self.assertIn("price_source", chain_schema["required"])
        self.assertIn("price_fetched_at", chain_schema["required"])
        self.assertEqual(
            chain_schema["properties"]["calls"]["items"]["$ref"],
            "#/components/schemas/OptionChainLiquidityRow",
        )
        self.assertEqual(
            chain_schema["properties"]["puts"]["items"]["$ref"],
            "#/components/schemas/OptionChainLiquidityRow",
        )


if __name__ == "__main__":
    unittest.main()
