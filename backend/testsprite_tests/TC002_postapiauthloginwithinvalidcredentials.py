import requests

def test_post_api_auth_login_with_invalid_credentials():
    base_url = "http://localhost:3001"
    endpoint = "/api/auth/login"
    url = base_url + endpoint
    headers = {
        "Content-Type": "application/json"
    }
    # Invalid credentials examples
    invalid_credentials_list = [
        {"email": "invalidemail@example.com", "password": "wrongpassword"},
        {"email": "user@example.com", "password": "incorrectpassword"},
        {"email": "", "password": "somepassword"},
        {"email": "user@example.com", "password": ""},
        {"email": "notanemail", "password": "password123"},
    ]

    for credentials in invalid_credentials_list:
        try:
            response = requests.post(url, json=credentials, headers=headers, timeout=30)
        except requests.RequestException as e:
            assert False, f"Request failed: {e}"

        # Acceptable status codes are 400 or 401
        assert response.status_code in (400, 401), \
            f"Expected status 400 or 401, got {response.status_code} for payload {credentials}"

        # Response should contain error details in JSON
        try:
            resp_json = response.json()
        except ValueError:
            assert False, "Response is not a valid JSON"

        # Check for error message or error details field presence
        error_keys = ["error", "message", "detail", "errors"]
        assert any(key in resp_json for key in error_keys), \
            f"Response JSON does not contain expected error details keys for payload {credentials}"

test_post_api_auth_login_with_invalid_credentials()
