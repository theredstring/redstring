#!/bin/sh
# Teach the Druid's small model by example, on this Mac (Apple MLX): LoRA on
# the teacher's checked answers (prepare.py), loss on the answer only.
#
#   MODEL=Qwen/Qwen3-1.7B sh training/druid/sft_mlx.sh
#
# Then fuse it into a model LM Studio can load, and judge it with the
# benchmark (training/druid/README.md). Settings are a first guess for a ~1.7B
# model in 24 GB; check `python -m mlx_lm lora --help` for the installed version's flags.
set -e
cd "$(dirname "$0")"
MODEL="${MODEL:-Qwen/Qwen3-1.7B}"
RUN="${RUN:-runs/sft-$(date +%Y%m%d-%H%M)}"
mkdir -p "$RUN"

python -m mlx_lm lora \
  --model "$MODEL" \
  --train \
  --data data/sft \
  --mask-prompt \
  --batch-size 4 \
  --num-layers 16 \
  --iters "${ITERS:-2000}" \
  --learning-rate "${LR:-1e-4}" \
  --steps-per-eval 200 \
  --val-batches 25 \
  --save-every 200 \
  --adapter-path "$RUN/adapter" | tee "$RUN/train.log"

python -m mlx_lm fuse --model "$MODEL" --adapter-path "$RUN/adapter" --save-path "models/$(basename "$RUN")"
echo "fused into models/$(basename "$RUN"): load it in LM Studio, then npm run druid:bench -- --mind openai --model <its id>"
