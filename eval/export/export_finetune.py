"""Converts a Hugging Face Whisper fine-tune to OpenAI checkpoint format, then runs
sherpa-onnx's own export script on it."""

import json
import os
import runpy
import subprocess
import sys
import urllib.request

import torch
import whisper
from huggingface_hub import snapshot_download
from safetensors.torch import load_file

SHERPA_TAG = "v2.0.3"
REPO_ID = "sarpba/whisper-hu-large-v3-turbo-finetuned"
OUTPUT_DIR = "/eval/.cache/models/whisper-hu-turbo-ft"

RENAMES = [
    ("model.", ""),
    ("encoder.embed_positions.weight", "encoder.positional_embedding"),
    ("decoder.embed_positions.weight", "decoder.positional_embedding"),
    ("embed_tokens", "token_embedding"),
    ("layers", "blocks"),
    ("self_attn_layer_norm", "attn_ln"),
    ("encoder_attn_layer_norm", "cross_attn_ln"),
    ("final_layer_norm", "mlp_ln"),
    ("encoder_attn.q_proj", "cross_attn.query"),
    ("encoder_attn.k_proj", "cross_attn.key"),
    ("encoder_attn.v_proj", "cross_attn.value"),
    ("encoder_attn.out_proj", "cross_attn.out"),
    ("self_attn.q_proj", "attn.query"),
    ("self_attn.k_proj", "attn.key"),
    ("self_attn.v_proj", "attn.value"),
    ("self_attn.out_proj", "attn.out"),
    ("fc1", "mlp.0"),
    ("fc2", "mlp.2"),
    ("encoder.layer_norm", "encoder.ln_post"),
    ("decoder.layer_norm", "decoder.ln"),
]


def to_openai_name(name):
    for old, new in RENAMES:
        name = name.replace(old, new)
    return name


def convert_to_openai_checkpoint(snapshot_dir, checkpoint_path):
    config = json.load(open(f"{snapshot_dir}/config.json"))
    dims = {
        "n_mels": config["num_mel_bins"],
        "n_audio_ctx": config["max_source_positions"],
        "n_audio_state": config["d_model"],
        "n_audio_head": config["encoder_attention_heads"],
        "n_audio_layer": config["encoder_layers"],
        "n_vocab": config["vocab_size"],
        "n_text_ctx": config["max_target_positions"],
        "n_text_state": config["d_model"],
        "n_text_head": config["decoder_attention_heads"],
        "n_text_layer": config["decoder_layers"],
    }
    state = load_file(f"{snapshot_dir}/model.safetensors")
    state = {
        to_openai_name(k): v.float() for k, v in state.items() if not k.startswith("proj_out")
    }
    torch.save({"dims": dims, "model_state_dict": state}, checkpoint_path)


def keep_only_int8_files():
    for name in os.listdir("."):
        if not (name.endswith(".int8.onnx") or name == "turbo-tokens.txt"):
            os.remove(name)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.chdir(OUTPUT_DIR)
    snapshot_dir = snapshot_download(REPO_ID, allow_patterns=["*.json", "*.safetensors", "*.txt"])
    convert_to_openai_checkpoint(snapshot_dir, "finetuned.pt")

    export_script = "export-onnx.py"
    url = f"https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/{SHERPA_TAG}/scripts/whisper/{export_script}"
    urllib.request.urlretrieve(url, export_script)

    original_export = torch.onnx.export
    torch.onnx.export = lambda *args, **kwargs: original_export(*args, dynamo=False, **kwargs)

    original_load_model = whisper.load_model
    whisper.load_model = lambda name, *args, **kwargs: original_load_model("finetuned.pt", *args, **kwargs)
    sys.argv = [export_script, "--model", "turbo"]
    runpy.run_path(export_script, run_name="__main__")
    keep_only_int8_files()


if __name__ == "__main__":
    main()
