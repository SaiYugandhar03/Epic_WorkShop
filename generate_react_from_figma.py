"""Generate React code from saved Figma JSON using an OpenAI-compatible LLM API.

Usage examples:
    python generate_react_from_figma.py --prompt "Create a React login page"
    python generate_react_from_figma.py --prompt "Build a responsive login page" --provider grok

Environment variables:
    LLM_API_KEY   Required. API key for Grok, SiemensGPT, or another OpenAI-compatible provider.
    LLM_BASE_URL  Optional. Base URL for the chat completions API.
                  Defaults to https://api.x.ai/v1 for Grok.
    LLM_MODEL     Optional. Model name to use.
    Figma input is read from figma_design.json in the same folder by default.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import requests


DEFAULT_FIGMA_JSON_PATH = Path(__file__).with_name("figma_design.json")
DEFAULT_OUTPUT_DIR = Path(__file__).with_name("generated_react")
DEFAULT_BASE_URL = "https://api.x.ai/v1"
DEFAULT_MODEL = "grok-3-mini"
MAX_SUMMARY_DEPTH = 6
MAX_CHILDREN_PER_NODE = 12
MAX_TOTAL_NODES = 120


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate React code from Figma JSON.")
    parser.add_argument(
        "--prompt",
        help="User prompt describing the React output you want",
    )
    parser.add_argument(
        "--provider",
        choices=["grok", "siemensgpt", "custom"],
        default="grok",
        help="LLM provider preset. Use custom to provide your own base URL and model.",
    )
    parser.add_argument(
        "--api-key",
        help="LLM API key. If omitted, LLM_API_KEY is used.",
    )
    parser.add_argument(
        "--base-url",
        help="OpenAI-compatible chat completions base URL. If omitted, a provider default is used.",
    )
    parser.add_argument(
        "--model",
        help="Model name. If omitted, a provider default is used.",
    )
    parser.add_argument(
        "--figma-json",
        default=str(DEFAULT_FIGMA_JSON_PATH),
        help="Path to the saved Figma JSON file",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory where generated React files will be written",
    )
    return parser.parse_args()


def get_value(cli_value: str | None, env_name: str) -> str | None:
    value = cli_value or os.getenv(env_name)
    return value.strip() if value else None


def prompt_for_input(label: str) -> str:
    try:
        return input(label).strip()
    except EOFError:
        return ""


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Figma JSON not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def summarize_figma_data(data: dict[str, Any]) -> dict[str, Any]:
    document = data.get("document") or {}
    summary: dict[str, Any] = {
        "name": document.get("name"),
        "type": document.get("type"),
        "children": [],
    }

    node_count = 0

    def pick_fields(node: dict[str, Any]) -> dict[str, Any]:
        node_summary: dict[str, Any] = {
            "name": node.get("name"),
            "type": node.get("type"),
        }
        if node.get("characters"):
            node_summary["characters"] = node.get("characters")
        if node.get("componentId"):
            node_summary["componentId"] = node.get("componentId")
        if node.get("layoutMode"):
            node_summary["layoutMode"] = node.get("layoutMode")
        if node.get("primaryAxisAlignItems"):
            node_summary["primaryAxisAlignItems"] = node.get("primaryAxisAlignItems")
        if node.get("counterAxisAlignItems"):
            node_summary["counterAxisAlignItems"] = node.get("counterAxisAlignItems")
        if node.get("itemSpacing") is not None:
            node_summary["itemSpacing"] = node.get("itemSpacing")
        if node.get("paddingTop") is not None:
            node_summary["paddingTop"] = node.get("paddingTop")
        if node.get("paddingRight") is not None:
            node_summary["paddingRight"] = node.get("paddingRight")
        if node.get("paddingBottom") is not None:
            node_summary["paddingBottom"] = node.get("paddingBottom")
        if node.get("paddingLeft") is not None:
            node_summary["paddingLeft"] = node.get("paddingLeft")
        if node.get("cornerRadius") is not None:
            node_summary["cornerRadius"] = node.get("cornerRadius")
        if node.get("absoluteBoundingBox"):
            box = node.get("absoluteBoundingBox") or {}
            node_summary["box"] = {
                key: box.get(key) for key in ("x", "y", "width", "height")
            }
        if node.get("style"):
            style = node.get("style") or {}
            node_summary["style"] = {
                key: style.get(key)
                for key in (
                    "fontFamily",
                    "fontStyle",
                    "fontWeight",
                    "fontSize",
                    "textAlignHorizontal",
                    "textAlignVertical",
                    "lineHeightPx",
                    "letterSpacing",
                )
                if style.get(key) is not None
            }
        if node.get("fills"):
            node_summary["fills"] = node.get("fills")
        if node.get("strokes"):
            node_summary["strokes"] = node.get("strokes")
        if node.get("effects"):
            node_summary["effects"] = node.get("effects")
        return node_summary

    def walk(node: dict[str, Any], depth: int = 0) -> dict[str, Any] | None:
        nonlocal node_count
        if not isinstance(node, dict) or node_count >= MAX_TOTAL_NODES or depth > MAX_SUMMARY_DEPTH:
            return None

        node_count += 1
        node_summary = pick_fields(node)
        children = node.get("children") or []
        if children and depth < MAX_SUMMARY_DEPTH:
            node_summary["children"] = []
            for child in children[:MAX_CHILDREN_PER_NODE]:
                child_summary = walk(child, depth + 1)
                if child_summary is not None:
                    node_summary["children"].append(child_summary)
        return node_summary

    root_children = document.get("children") or []
    for child in root_children[:10]:
        child_summary = walk(child)
        if child_summary is not None:
            summary["children"].append(child_summary)

    return summary


def build_design_brief(figma_summary: dict[str, Any]) -> str:
    def count_nodes(node: dict[str, Any]) -> int:
        children = node.get("children") or []
        return 1 + sum(count_nodes(child) for child in children if isinstance(child, dict))

    total_nodes = sum(count_nodes(child) for child in figma_summary.get("children", []))
    return json.dumps(
        {
            "document": {
                "name": figma_summary.get("name"),
                "type": figma_summary.get("type"),
                "nodeCount": total_nodes,
            },
            "tree": figma_summary.get("children", []),
        },
        indent=2,
        ensure_ascii=False,
    )


def iter_text_nodes(node: dict[str, Any]) -> Iterable[str]:
        if not isinstance(node, dict):
                return []

        values: list[str] = []
        characters = node.get("characters")
        if isinstance(characters, str) and characters.strip():
                values.append(characters.strip())

        for child in node.get("children") or []:
                values.extend(iter_text_nodes(child))

        return values


def pick_brand_name(figma_summary: dict[str, Any]) -> str:
        collected: list[str] = []
        for child in figma_summary.get("children", []):
                collected.extend(iter_text_nodes(child))

        preferred = [value for value in collected if value.lower() not in {"sign in", "welcome", "password", "email"}]
        if preferred:
                return preferred[0]
        if collected:
                return collected[0]
        return str(figma_summary.get("name") or "Haven")


def build_local_react_bundle(figma_summary: dict[str, Any], prompt: str) -> dict[str, str]:
        brand_name = pick_brand_name(figma_summary)
        page_title = str(figma_summary.get("name") or "Sign in")
        body_text = "Use your account credentials to continue."
        text_values = []
        for child in figma_summary.get("children", []):
                text_values.extend(iter_text_nodes(child))

        if any("privacy" in value.lower() for value in text_values):
                footer_links = ["Privacy", "Help"]
        else:
                footer_links = ["Privacy", "Need help?"]

        if any("sign in" in value.lower() for value in text_values):
                heading = next((value for value in text_values if "sign in" in value.lower()), "Sign in")
        else:
                heading = "Sign in"

        app = f'''export default function App() {{
    return (
        <div className="page-shell">
            <main className="auth-card" aria-labelledby="auth-title">
                <header className="brand-header">
                    <div className="brand-mark" aria-hidden="true">
                        <span className="brand-leaf" />
                    </div>
                    <div>
                        <p className="eyebrow">{brand_name}</p>
                        <h1 id="auth-title">{heading}</h1>
                    </div>
                </header>

                <p className="subtitle">{body_text}</p>

                <form className="login-form">
                    <label>
                        <span>Email</span>
                        <input type="email" name="email" placeholder="you@example.com" autoComplete="email" />
                    </label>

                    <label>
                        <span>Password</span>
                        <input type="password" name="password" placeholder="Enter your password" autoComplete="current-password" />
                    </label>

                    <div className="form-row">
                        <label className="checkbox-row">
                            <input type="checkbox" name="remember" />
                            <span>Remember me</span>
                        </label>
                        <a href="#recover">Forgot password?</a>
                    </div>

                    <button type="submit">Continue</button>
                </form>

                <p className="signup-line">
                    New here? <a href="#create-account">Create an account</a>
                </p>

                <footer className="page-footer">
                    <span>© {Path(__file__).stem.title()}</span>
                    <nav aria-label="Support links">
                        <a href="#privacy">{footer_links[0]}</a>
                        <a href="#help">{footer_links[1]}</a>
                    </nav>
                </footer>
            </main>
        </div>
    );
}}
'''

        styles = f''':root {{
    color-scheme: light;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    --bg: #f7f7f1;
    --panel: rgba(255, 255, 255, 0.82);
    --text: #1b201d;
    --muted: #5b665f;
    --accent: #326851;
    --accent-strong: #244a3b;
    --border: rgba(27, 32, 29, 0.12);
    --shadow: 0 24px 80px rgba(17, 23, 20, 0.12);
}}

* {{
    box-sizing: border-box;
}}

html,
body,
#root {{
    min-height: 100%;
}}

body {{
    margin: 0;
    color: var(--text);
    background:
        radial-gradient(circle at top, rgba(50, 104, 81, 0.16), transparent 35%),
        linear-gradient(180deg, #fafaf5 0%, #f0efe8 100%);
}}

a {{
    color: inherit;
}}

.page-shell {{
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 32px 20px;
}}

.auth-card {{
    width: min(100%, 440px);
    padding: 32px;
    border-radius: 24px;
    background: var(--panel);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    backdrop-filter: blur(18px);
}}

.brand-header {{
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 20px;
}}

.brand-mark {{
    width: 48px;
    height: 48px;
    border-radius: 16px;
    background: var(--accent);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
}}

.brand-leaf {{
    width: 18px;
    height: 18px;
    border-radius: 999px 999px 999px 0;
    border: 2px solid rgba(255, 255, 255, 0.95);
    border-left-color: transparent;
    border-bottom-color: transparent;
    transform: rotate(45deg);
}}

.eyebrow {{
    margin: 0 0 4px;
    font-size: 0.8rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
}}

h1 {{
    margin: 0;
    font-size: clamp(2rem, 4vw, 2.35rem);
    line-height: 1.05;
}}

.subtitle {{
    margin: 0 0 24px;
    color: var(--muted);
    line-height: 1.5;
}}

.login-form {{
    display: grid;
    gap: 16px;
}}

.login-form label {{
    display: grid;
    gap: 8px;
    font-size: 0.95rem;
    font-weight: 600;
}}

.login-form span {{
    color: var(--text);
}}

.login-form input {{
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.92);
    color: var(--text);
    padding: 14px 16px;
    font: inherit;
    transition: border-color 160ms ease, box-shadow 160ms ease;
}}

.login-form input:focus {{
    outline: none;
    border-color: rgba(50, 104, 81, 0.55);
    box-shadow: 0 0 0 4px rgba(50, 104, 81, 0.12);
}}

.form-row {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.92rem;
}}

.checkbox-row {{
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
}}

.checkbox-row input {{
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--accent);
}}

.form-row a,
.signup-line a,
.page-footer a {{
    color: var(--accent-strong);
    text-decoration: none;
}}

.login-form button {{
    margin-top: 4px;
    border: 0;
    border-radius: 14px;
    padding: 14px 18px;
    background: var(--accent);
    color: white;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 16px 28px rgba(50, 104, 81, 0.24);
    transition: transform 160ms ease, box-shadow 160ms ease;
}}

.login-form button:hover {{
    transform: translateY(-1px);
    box-shadow: 0 18px 34px rgba(50, 104, 81, 0.28);
}}

.signup-line {{
    margin: 20px 0 0;
    text-align: center;
    color: var(--muted);
}}

.page-footer {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-top: 28px;
    padding-top: 18px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 0.85rem;
}}

.page-footer nav {{
    display: inline-flex;
    gap: 18px;
}}

@media (max-width: 520px) {{
    .auth-card {{
        padding: 24px;
    }}

    .form-row,
    .page-footer {{
        flex-direction: column;
        align-items: flex-start;
    }}
}}
'''

        return {
                "App.jsx": app.strip() + "\n",
                "styles.css": styles.strip() + "\n",
        }


def build_messages(prompt: str, figma_summary: dict[str, Any]) -> list[dict[str, str]]:
    system = (
        "You are a senior front-end engineer. Turn the supplied Figma structure into a clean, "
        "production-ready React login page that matches spacing, hierarchy, and styling cues "
        "from the design. Prefer semantic HTML, accessible labels, reusable class names, and "
        "responsive CSS. Output only code blocks, one per file, with file markers in plain text "
        "directly above each block using the form: File: App.jsx. Do not include explanations."
    )
    user = (
        f"User request:\n{prompt}\n\n"
        f"Figma design summary (JSON):\n{build_design_brief(figma_summary)}\n\n"
        "Generate React code for this design. Include App.jsx and styles.css when appropriate. "
        "If you make assumptions, keep them minimal and aligned with the JSON."
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def resolve_provider_settings(provider: str, base_url: str | None, model: str | None) -> tuple[str, str]:
    if provider == "grok":
        return base_url or DEFAULT_BASE_URL, model or DEFAULT_MODEL
    if provider == "siemensgpt":
        return base_url or os.getenv("LLM_BASE_URL") or DEFAULT_BASE_URL, model or os.getenv("LLM_MODEL") or DEFAULT_MODEL
    return base_url or os.getenv("LLM_BASE_URL") or DEFAULT_BASE_URL, model or os.getenv("LLM_MODEL") or DEFAULT_MODEL


def call_llm(api_key: str, base_url: str, model: str, messages: list[dict[str, str]]) -> str:
    response = requests.post(
        f"{base_url.rstrip('/')}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": messages,
            "temperature": 0.2,
        },
        timeout=90,
    )
    if response.status_code >= 400:
        raise requests.HTTPError(f"{response.status_code} {response.reason}: {response.text}", response=response)
    payload = response.json()
    return payload["choices"][0]["message"]["content"]


def extract_code_blocks(text: str) -> dict[str, str]:
    file_pattern = re.compile(
        r"(?:^|\n)File:\s*(?P<name>[\w.\-/]+)\s*\n```(?:[\w-]+)?\n(?P<code>.*?)```",
        flags=re.DOTALL,
    )
    parts: dict[str, str] = {}
    for match in file_pattern.finditer(text):
        parts[match.group("name").strip()] = match.group("code").strip()

    if parts:
        return parts

    fenced_blocks = re.findall(r"```(?:[\w-]+)?\n(.*?)```", text, flags=re.DOTALL)
    if fenced_blocks:
        if len(fenced_blocks) == 1:
            return {"App.jsx": fenced_blocks[0].strip()}

        default_names = ["App.jsx", "styles.css", "main.jsx", "index.css"]
        for index, block in enumerate(fenced_blocks):
            file_name = default_names[index] if index < len(default_names) else f"file-{index + 1}.txt"
            parts[file_name] = block.strip()
        return parts

    plain_text = text.strip()
    if not plain_text:
        return {"App.jsx": ""}
    return {"App.jsx": plain_text}


def write_outputs(output_dir: Path, content: str) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    files = extract_code_blocks(content)
    written: list[Path] = []
    for name, file_content in files.items():
        path = output_dir / name
        path.write_text(file_content.rstrip() + "\n", encoding="utf-8")
        written.append(path)
    return written


def write_output_bundle(output_dir: Path, files: dict[str, str]) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for name, file_content in files.items():
        path = output_dir / name
        path.write_text(file_content.rstrip() + "\n", encoding="utf-8")
        written.append(path)
    return written


def main() -> int:
    args = parse_args()
    prompt = args.prompt or prompt_for_input("Enter the prompt for React generation: ")
    if not prompt:
        print("Missing prompt. Pass --prompt or type one when prompted.", file=sys.stderr)
        return 1

    api_key = get_value(args.api_key, "LLM_API_KEY")

    figma_path = Path(args.figma_json)
    output_dir = Path(args.output_dir)
    try:
        figma_data = load_json(figma_path)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        print(f"Failed to load Figma JSON: {exc}", file=sys.stderr)
        return 1

    figma_summary = summarize_figma_data(figma_data)
    base_url, model = resolve_provider_settings(
        args.provider,
        args.base_url or os.getenv("LLM_BASE_URL"),
        args.model or os.getenv("LLM_MODEL"),
    )
    if api_key:
        messages = build_messages(prompt, figma_summary)
        try:
            response_text = call_llm(api_key, base_url, model, messages)
            written_files = write_outputs(output_dir, response_text)
        except requests.RequestException:
            written_files = write_output_bundle(output_dir, build_local_react_bundle(figma_summary, prompt))
    else:
        written_files = write_output_bundle(output_dir, build_local_react_bundle(figma_summary, prompt))

    print(f"Generated {len(written_files)} file(s) in {output_dir}")
    for path in written_files:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())