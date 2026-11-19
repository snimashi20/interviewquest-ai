import io

# the file types we can read. anything else is rejected before we save it
SUPPORTED_EXTENSIONS = (".pdf", ".docx", ".txt", ".md")

# a CV is a couple of pages, so anything much bigger is either the wrong file or an attack
MAX_CV_BYTES = 5 * 1024 * 1024  # 5 MB

# if we pulled out less than this, the file was probably a scan/photo with no real text layer
MIN_TEXT_LENGTH = 200

# only the first part of the CV is fed to the AI, so one enormous file can't blow up the
# token bill. two pages of text sits well under this
MAX_TEXT_CHARS = 20000


# a file we can't read - the router turns this into a 400 so the student sees why
class CVExtractionError(Exception):
    pass


# pull the text out of a PDF, page by page
def _read_pdf(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    # extract_text() returns None for pages with no text layer, so default to ""
    return "\n".join((page.extract_text() or "") for page in reader.pages)


# pull the text out of a Word document - paragraphs plus anything inside tables,
# because plenty of CV templates lay the whole page out as an invisible table
def _read_docx(data: bytes) -> str:
    from docx import Document

    document = Document(io.BytesIO(data))
    parts = [paragraph.text for paragraph in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            parts.extend(cell.text for cell in row.cells)
    return "\n".join(parts)


# tidy up the extracted text: drop trailing spaces and collapse runs of blank lines,
# which PDF extraction produces a lot of
def _clean(text: str) -> str:
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").split("\n")]

    cleaned: list[str] = []
    for line in lines:
        if not line and cleaned and not cleaned[-1]:
            continue  # already have one blank line here, skip this one
        cleaned.append(line)

    return "\n".join(cleaned).strip()


# the one function the router calls: bytes in, plain text out.
# raises CVExtractionError with a student-friendly message if the file is no good
def extract_cv_text(filename: str, data: bytes) -> str:
    name = (filename or "").lower()

    if not name.endswith(SUPPORTED_EXTENSIONS):
        allowed = ", ".join(SUPPORTED_EXTENSIONS)
        raise CVExtractionError(f"Unsupported file type. Please upload one of: {allowed}")

    if not data:
        raise CVExtractionError("That file is empty.")

    if len(data) > MAX_CV_BYTES:
        raise CVExtractionError(f"That file is too large (limit {MAX_CV_BYTES // (1024 * 1024)} MB).")

    try:
        if name.endswith(".pdf"):
            text = _read_pdf(data)
        elif name.endswith(".docx"):
            text = _read_docx(data)
        else:
            text = data.decode("utf-8", errors="replace")
    except CVExtractionError:
        raise
    except Exception as exc:  # noqa: BLE001 - a corrupt file shouldn't 500 the whole API
        raise CVExtractionError(f"Could not read that file: {exc}") from exc

    text = _clean(text)

    if len(text) < MIN_TEXT_LENGTH:
        raise CVExtractionError(
            "Couldn't find readable text in that file. If it's a scanned CV, "
            "please upload a text-based PDF or a DOCX instead."
        )

    return text[:MAX_TEXT_CHARS]
