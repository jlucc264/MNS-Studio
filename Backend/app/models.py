from pydantic import BaseModel
from typing import Optional, List


class CandidateImage(BaseModel):
    id: str
    url: str
    title: Optional[str] = None
    provider: Optional[str] = None


class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: str


class ImportUrlRequest(BaseModel):
    image_url: str


class VisualizeRequest(BaseModel):
    image_url: str
    stitch_width: int
    stitch_height: int
    color_count: int = 16
    show_grid: bool = True
    mesh_count: int = 13
    contrast_level: str = "normal"
    source_type: str = "photo"

class PaletteColor(BaseModel):
    hex: str
    dmc_code: str
    dmc_name: str


class VisualizeResponse(BaseModel):
    message: str
    stitch_preview_url: str
    palette: list[PaletteColor]
    settings: dict
    cells: list[list[str]]


class AppResponse(BaseModel):
    action: str
    message: str
    active_image_url: Optional[str] = None
    stitch_preview_url: Optional[str] = None
    candidate_images: List[CandidateImage] = []
    metadata: dict = {}

class FinalizeRequest(BaseModel):
    preview_url: str
    width_inches: float
    height_inches: float
    mesh_count: int
    color_count: int
    contrast_level: str
    show_grid: bool
    palette: list[PaletteColor]
    cells: list[list[str]]


class FinalizeResponse(BaseModel):
    message: str
    pdf_url: str

class RecolorRequest(BaseModel):
    image_url: str
    stitch_width: int
    stitch_height: int
    mesh_count: int
    show_grid: bool = True
    selected_palette: list[PaletteColor]

class RecolorResponse(BaseModel):
    message: str
    stitch_preview_url: str
    palette: list[PaletteColor]
    cells: list[list[str]]

class GridCellResponse(BaseModel):
    cells: list[list[str]]
