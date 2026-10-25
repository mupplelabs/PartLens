print("Server script starting...", flush=True)
import os
# Verhindere Pydantic, OTEL & Telemetrie Deadlock/Overhead in Python 3.14
os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["OTEL_PYTHON_DISABLED"] = "true"
os.environ["PYDANTIC_DISABLE_PLUGINS"] = "1"
os.environ["PYDANTIC_AI_NO_BANNER"] = "1"
os.environ["LOGFIRE_IGNORE_NO_CONFIG"] = "1"
os.environ["FASTAPI_TELEMETRY_ENABLED"] = "0"
import sys
import io
import time
import uuid
import asyncio
import threading
import base64
import json
import re
import traceback
from pathlib import Path
from typing import Literal, Optional
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from PIL import Image
print("Starting server...")