"""Fetch a Figma file and save the raw design JSON locally.

Usage:
	python extract_figma.py --file-key YOUR_FILE_KEY --token YOUR_FIGMA_TOKEN

You can also set FIGMA_FILE_KEY and FIGMA_TOKEN environment variables.
By default the response is written to figma_design.json.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests


FIGMA_API_URL = "https://api.figma.com/v1/files/{file_key}"
DEFAULT_OUTPUT_PATH = Path(__file__).with_name("figma_design.json")


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description="Download a Figma file as JSON.")
	parser.add_argument("--file-key", help="Figma file key from the design URL")
	parser.add_argument("--token", help="Figma personal access token")
	parser.add_argument(
		"--output",
		default=str(DEFAULT_OUTPUT_PATH),
		help="Path to write the downloaded JSON",
	)
	return parser.parse_args()


def get_value(cli_value: str | None, env_name: str) -> str | None:
	value = cli_value or os.getenv(env_name)
	return value.strip() if value else None


def fetch_figma_file(file_key: str, token: str) -> dict:
	response = requests.get(
		FIGMA_API_URL.format(file_key=file_key),
		headers={"X-Figma-Token": token},
		timeout=30,
	)
	if response.status_code >= 400:
		raise requests.HTTPError(
			f"{response.status_code} {response.reason}: {response.text}",
			response=response,
		)
	return response.json()


def save_json(data: dict, output_path: Path) -> None:
	output_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> int:
	args = parse_args()
	file_key = get_value(args.file_key, "FIGMA_FILE_KEY")
	token = get_value(args.token, "FIGMA_TOKEN")

	if not file_key:
		print("Missing Figma file key. Pass --file-key or set FIGMA_FILE_KEY.", file=sys.stderr)
		return 1

	if not token:
		print("Missing Figma token. Pass --token or set FIGMA_TOKEN.", file=sys.stderr)
		return 1

	try:
		data = fetch_figma_file(file_key, token)
	except requests.RequestException as exc:
		print(f"Failed to fetch Figma file: {exc}", file=sys.stderr)
		return 1

	output_path = Path(args.output)
	save_json(data, output_path)
	print(f"Saved Figma design JSON to {output_path}")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
