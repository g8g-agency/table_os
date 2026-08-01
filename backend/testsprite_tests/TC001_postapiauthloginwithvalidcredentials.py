import requests

BASE_URL = "http://localhost:3001"
LOGIN_ENDPOINT = "/api/auth/login"
TIMEOUT = 30

def test_post_api_auth_login_with_valid_credentials():
    url = BASE_URL + LOGIN_ENDPOINT
    headers = {"Content-Type": "application/json"}
    # Provide valid credentials here; these should be replaced with actual valid test credentials
    payload = {
        "email": "validuser@example.com",
        "password": "ValidPassword123!"
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
        assert response.status_code == 200, f"Expected status code 200, got {response.status_code}"

        json_response = response.json()
        # The response should contain a token (JWT)
        assert "token" in json_response or "accessToken" in json_response, "Response JSON does not contain JWT token"
        token_value = json_response.get("token") or json_response.get("accessToken")
        assert isinstance(token_value, str) and len(token_value) > 0, "JWT token is empty or not a string"

    except requests.RequestException as e:
        assert False, f"Request to {url} failed with exception: {e}"

test_post_api_auth_login_with_valid_credentials()