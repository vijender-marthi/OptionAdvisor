import unittest


class AuthApiContractTests(unittest.TestCase):
    def test_auth_endpoints_are_exposed_in_openapi_contract(self) -> None:
        import main

        schema = main.app.openapi()
        paths = schema["paths"]
        expected_routes = {
            ("post", "/api/auth/register"): "AuthRegisterResponse",
            ("post", "/api/auth/login"): "AuthSessionResponse",
            ("post", "/api/auth/google"): "AuthSessionResponse",
            ("get", "/api/auth/activate"): "AuthActivateResponse",
            ("post", "/api/auth/forgot-password"): "AuthForgotPasswordResponse",
            ("post", "/api/auth/reset-password"): "AuthResetPasswordResponse",
        }
        for (method, path), response_model in expected_routes.items():
            self.assertIn(path, paths)
            self.assertIn(method, paths[path])
            response = paths[path][method]["responses"]["200"]["content"]["application/json"]["schema"]
            self.assertEqual(response["$ref"], f"#/components/schemas/{response_model}")

        schemas = schema["components"]["schemas"]
        for model_name in {
            "AuthRegisterResponse",
            "AuthSessionResponse",
            "AuthActivateResponse",
            "AuthForgotPasswordResponse",
            "AuthResetPasswordResponse",
        }:
            self.assertIn(model_name, schemas)

        session_required = schemas["AuthSessionResponse"]["required"]
        self.assertIn("access_token", session_required)
        self.assertIn("token_type", session_required)
        self.assertIn("email", session_required)
        self.assertIn("role", session_required)


if __name__ == "__main__":
    unittest.main()
