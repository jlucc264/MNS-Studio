from pydantic import BaseModel
from typing import Any, Optional


class ContactRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    category: str
    message: str


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
    clean_background: bool = False
    simplify_colors: bool = False
    strengthen_dark_detail: bool = False
    preserve_accents: bool = False
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
    metadata: dict = {}

class FinalizeRequest(BaseModel):
    preview_url: Optional[str] = None
    width_inches: float
    height_inches: float
    mesh_count: int
    color_count: int
    contrast_level: str
    show_grid: bool
    palette: list[PaletteColor]
    cells: list[list[str]]
    previous_pdf_url: Optional[str] = None


class FinalizeResponse(BaseModel):
    message: str
    pdf_url: str
    preview_image_url: str

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


class ProjectSaveRequest(BaseModel):
    name: str = "Untitled"
    width_inches: Optional[float] = None
    height_inches: Optional[float] = None
    mesh_count: Optional[int] = None
    color_count: Optional[int] = None
    contrast_level: Optional[str] = None
    source_type: Optional[str] = None
    show_grid: Optional[bool] = None
    clean_background: Optional[bool] = None
    simplify_colors: Optional[bool] = None
    strengthen_dark_detail: Optional[bool] = None
    preserve_accents: Optional[bool] = None
    palette: Optional[list[PaletteColor]] = None
    cells: Optional[list[list[str]]] = None
    source_image_url: Optional[str] = None
    preview_image_url: Optional[str] = None
    pdf_url: Optional[str] = None
    finalized: bool = False


class ProjectResponse(BaseModel):
    id: str
    created_at: str
    updated_at: str
    name: str
    finalized: bool
    width_inches: Optional[float] = None
    height_inches: Optional[float] = None
    mesh_count: Optional[int] = None
    color_count: Optional[int] = None
    contrast_level: Optional[str] = None
    source_type: Optional[str] = None
    show_grid: Optional[bool] = None
    clean_background: Optional[bool] = None
    simplify_colors: Optional[bool] = None
    strengthen_dark_detail: Optional[bool] = None
    preserve_accents: Optional[bool] = None
    palette: Optional[list] = None
    cells: Optional[list] = None
    source_image_url: Optional[str] = None
    preview_image_url: Optional[str] = None
    pdf_url: Optional[str] = None


class PrintOwnCheckoutRequest(BaseModel):
    pdf_url: str
    width_inches: float
    height_inches: float
    parent_gallery_item_id: Optional[str] = None


class CheckoutResponse(BaseModel):
    client_secret: str


class GalleryCreateRequest(BaseModel):
    title: str
    tags: list[str] = []
    submitter_name: Optional[str] = None
    preview_image_url: Optional[str] = None
    pdf_url: str
    width_inches: Optional[float] = None
    height_inches: Optional[float] = None
    mesh_count: Optional[int] = None
    color_count: Optional[int] = None
    palette: Optional[list] = None
    has_outline: Optional[bool] = None
    project_id: Optional[str] = None
    parent_gallery_item_id: Optional[str] = None


class CanvasContext(BaseModel):
    source_mode: str = "photo"
    width_inches: float = 5.0
    height_inches: float = 5.0
    mesh_count: int = 18
    color_count: int = 128
    has_preview: bool = False
    has_source_image: bool = False
    palette: list[dict] = []
    clean_background: bool = False
    simplify_colors: bool = False
    strengthen_dark_detail: bool = False
    preserve_accents: bool = False
    contrast_level: str = "normal"
    show_grid: bool = True


class LlmChatRequest(BaseModel):
    message: str
    context: CanvasContext = CanvasContext()


class ChatActionItem(BaseModel):
    type: str
    value: Any = None
    from_codes: list[str] = []
    to_code: str = ""
    setting: str = ""
    url: str = ""
    width_inches: Optional[float] = None
    height_inches: Optional[float] = None
    mesh_count: Optional[int] = None


class LlmChatResponse(BaseModel):
    reply: str
    actions: list[ChatActionItem] = []
    image_url: Optional[str] = None


class SuggestionsRequest(BaseModel):
    context: CanvasContext = CanvasContext()


class SuggestionsResponse(BaseModel):
    suggestions: list[str]


class GalleryItemResponse(BaseModel):
    id: str
    created_at: str
    user_id: str
    title: str
    tags: list[str] = []
    submitter_name: Optional[str] = None
    preview_image_url: Optional[str] = None
    pdf_url: str
    width_inches: Optional[float] = None
    height_inches: Optional[float] = None
    mesh_count: Optional[int] = None
    color_count: Optional[int] = None
    palette: Optional[list] = None
    has_outline: bool = False
    like_count: int = 0
    liked_by_me: bool = False
    share_count: int = 0
    project_id: Optional[str] = None
    parent_gallery_item_id: Optional[str] = None
