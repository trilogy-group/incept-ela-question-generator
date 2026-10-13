"""Validate every keyword used by the two vendored public transport schemas.

This is schema validation, not a question-quality judgment. Unsupported new
schema keywords stop validation instead of being silently ignored.
"""

from generator import InputError


SUPPORTED = {"$schema", "title", "description", "type", "required", "properties", "items", "const", "enum", "additionalProperties"}


def validate(value, schema, location="packet"):
    unknown = set(schema) - SUPPORTED
    if unknown:
        raise InputError(f"{location}: unsupported transport schema keywords")
    types = {
        "object": lambda candidate: isinstance(candidate, dict),
        "array": lambda candidate: isinstance(candidate, list),
        "string": lambda candidate: isinstance(candidate, str),
        "integer": lambda candidate: isinstance(candidate, int) and not isinstance(candidate, bool),
    }
    expected = schema.get("type")
    if expected is not None and (expected not in types or not types[expected](value)):
        raise InputError(f"{location}: expected {expected}")
    if "const" in schema and value != schema["const"]:
        raise InputError(f"{location}: contract value does not match")
    if "enum" in schema and value not in schema["enum"]:
        raise InputError(f"{location}: unsupported value")
    if isinstance(value, dict):
        missing = set(schema.get("required", [])) - set(value)
        if missing:
            raise InputError(f"{location}: missing required transport fields")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False and set(value) - set(properties):
            raise InputError(f"{location}: unexpected transport fields")
        for name, subschema in properties.items():
            if name in value:
                validate(value[name], subschema, f"{location}.{name}")
    if isinstance(value, list) and "items" in schema:
        for number, item in enumerate(value):
            validate(item, schema["items"], f"{location}[{number}]")
