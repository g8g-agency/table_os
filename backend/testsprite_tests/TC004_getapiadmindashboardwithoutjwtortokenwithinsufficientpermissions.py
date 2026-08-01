import requests

BASE_URL = "http://localhost:3001"
TIMEOUT = 30

def test_get_api_admin_dashboard_without_jwt_or_insufficient_permissions():
    url = f"{BASE_URL}/api/admin/dashboard"
    headers_no_token = {}
    
    # Test without JWT token
    try:
        response = requests.get(url, headers=headers_no_token, timeout=TIMEOUT)
        assert response.status_code in (401, 403), f"Expected 401 or 403 but got {response.status_code}"
    except requests.RequestException as e:
        assert False, f"Request failed without token: {e}"

    # Test with a token having insufficient permissions
    # We login as a user with insufficient permissions to get such a token
    login_url = f"{BASE_URL}/api/auth/login"
    # Assuming these credentials belong to a user with insufficient permissions
    insufficient_user_credentials = {
        "email": "insufficient@user.com",
        "password": "password123"
    }

    token = None
    try:
        login_resp = requests.post(login_url, json=insufficient_user_credentials, timeout=TIMEOUT)
        if login_resp.status_code == 200:
            json_resp = login_resp.json()
            token = json_resp.get("token")
        else:
            # If login fails, we cannot proceed with permission test, fail immediately
            assert False, f"Login for insufficient permissions user failed with status {login_resp.status_code}"
    except requests.RequestException as e:
        assert False, f"Login request failed: {e}"

    if token:
        headers_insufficient = {
            "Authorization": f"Bearer {token}"
        }
        try:
            resp_with_token = requests.get(url, headers=headers_insufficient, timeout=TIMEOUT)
            assert resp_with_token.status_code in (401, 403), f"Expected 401 or 403 but got {resp_with_token.status_code}"
        except requests.RequestException as e:
            assert False, f"Request with insufficient permissions token failed: {e}"

test_get_api_admin_dashboard_without_jwt_or_insufficient_permissions()