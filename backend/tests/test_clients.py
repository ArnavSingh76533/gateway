import json
from typing import Any

from conftest import connect, register
from universal_gateway import AsyncGateway


async def test_openai_sdk_model_list_chat_and_stream(environment: Any) -> None:
    _, client, _ = environment
    key, _ = await register(client)
    await connect(client)
    sdk = AsyncGateway(base_url="http://test/v1", api_key=key, http_client=client)
    models = await sdk.models.list()
    response = await sdk.chat.completions.create(
        model=models.data[0].id, messages=[{"role": "user", "content": "hello"}]
    )
    assert response.choices[0].message.content == "Hello"
    stream = await sdk.chat.completions.create(
        model="model-a", messages=[{"role": "user", "content": "hello"}], stream=True
    )
    chunks = [chunk async for chunk in stream]
    assert chunks[0].choices[0].delta.content == "Hello"


async def test_messages_bridge_text_tools_and_stream(environment: Any) -> None:
    _, client, upstream = environment
    key, _ = await register(client)
    await connect(client)
    headers = {"x-api-key": key, "anthropic-version": "2023-06-01"}
    body = {
        "model": "model-a",
        "max_tokens": 300,
        "system": [{"type": "text", "text": "Be helpful"}],
        "messages": [{"role": "user", "content": "Hello"}],
        "tools": [{"name": "lookup", "input_schema": {"type": "object", "properties": {}}}],
    }
    response = await client.post("/v1/messages", json=body, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["content"][0]["text"] == "Hello"
    assert len(response.content) == int(response.headers["content-length"])
    sent = json.loads(upstream.calls[-1].content)
    assert sent["tools"][0]["function"]["name"] == "lookup"
    assert sent["messages"][0] == {"role": "system", "content": "Be helpful"}
    result = await client.post("/v1/messages", json={**body, "stream": True}, headers=headers)
    assert "event: message_start" in result.text and "event: message_stop" in result.text
    assert "text_delta" in result.text and "Hello" in result.text
    thinking = await client.post(
        "/v1/messages", json={**body, "thinking": {"type": "enabled"}}, headers=headers
    )
    assert thinking.status_code == 400
    count = await client.post("/v1/messages/count_tokens", json=body, headers=headers)
    assert (
        count.status_code == 200
        and count.headers["x-gateway-token-count"] == "conservative-byte-estimate"
    )
