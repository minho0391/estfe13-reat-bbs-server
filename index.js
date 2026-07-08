const express = require("express");
const cors = require("cors");
const app = express();
const mysql = require("mysql2");
const port = process.env.PORT || 3000;
const multer = require("multer");
const fs = require("fs");
const path = require("path");

app.use(express.json()); //json->object
app.use(express.urlencoded({ extended: true })); //html form ->object
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
// /uploads  절대경로 upload 폴더에 접근 권한 부여

let corsOptions = {
  origin: "*",
};

app.use(cors(corsOptions));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "uploads"));
  },
  filename: function (req, file, cb) {
    const orinalExt = file.originalname.split(".")[1];
    const uniquePrefix = Date.now() + "-" + Math.round(Math.random() * 1000);
    cb(null, uniquePrefix + "-" + file.fieldname + "." + orinalExt);
  },
});

const upload = multer({ storage: storage });

const db = mysql.createConnection({
  host: "localhost",
  user: "user_bbs",
  password: "12345",
  database: "bbs",
});

db.connect();

function deleteUploadedFile(filePath) {
  if (!filePath) return;
  const absolutePath = path.resolve(filePath); //삭제할 파일의 절대 경로 확인
  if (fs.existsSync(absolutePath)) {
    //실제 서버 있는지 확인
    fs.unlinkSync(absolutePath);
  }
}

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/list", (req, res) => {
  const sqlQuery =
    "SELECT id, title, content, writer, DATE_FORMAT(date, '%Y-%m-%d') AS date FROM board;";
  db.query(sqlQuery, (err, result) => {
    if (err) throw err;
    res.send(result);
  });
});

app.get("/view", (req, res) => {
  console.log(req.query.id);
  const id = req.query.id;
  // const sqlQuery = `SELECT * FROM board WHERE id=${req.query.id};`;
  const sqlQuery =
    "SELECT title, content, writer, image_path, DATE_FORMAT(date, '%Y-%m-%d') AS date FROM board WHERE id=?;";
  db.query(sqlQuery, [id], (err, result) => {
    if (err) throw err;
    res.send(result);
  });
});

app.post("/write", upload.single("image"), (req, res) => {
  console.log(req.body);
  const { title, writer, content } = req.body;
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null; //req.file.path는 업로드된 파일의 경로

  const sqlQuery = "insert into board (title,content,writer,image_path) values (?,?,?,?);";
  db.query(sqlQuery, [title, content, writer, imagePath], (err, result) => {
    if (err) throw err;
    res.send(result);
  });
});

app.post("/delete", (req, res) => {
  console.log(req.body);
  const { id } = req.body;

  //글 번호 삭제할 이미지의 경로 파악
  db.query("SELECT image_path FROM board WHERE id=?", [id], (err, result) => {
    if (err) throw err;
    const existingImagePath = result[0] ? result[0].image_path : null;
    deleteUploadedFile(existingImagePath);
  });

  const sqlQuery = "DELETE FROM board WHERE id=?";
  db.query(sqlQuery, [id], (err, result) => {
    if (err) throw err;
    res.send(result);
  });
});

app.post("/deleteselect", (req, res) => {
  console.log(req.body);
  const { boardIdList } = req.body;
  //서버에서 여러 이미지 삭제
  db.query(`SELECT image_path FROM board WHERE id in (${boardIdList})`, (err, result) => {
    if (err) throw err;
    if (result && result.length > 0) {
      result.forEach(item => {
        deleteUploadedFile(item.image_path);
      });
    }
  });

  //테이블에서 글 여러개 삭제
  const sqlQuery = `delete from board where id in (${boardIdList})`;
  db.query(sqlQuery, (err, result) => {
    if (err) throw err;
    res.send(result);
  });
});

app.post("/update", upload.single("image"), (req, res) => {
  console.log(req.body);
  const { writer, title, content, id, remove_image } = req.body;
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null; //새이미지 정보 할당
  const shouldRemoveImage = remove_image === "1";

  let sqlQuery;
  let params;

  //상황별 sqlQuery params 정의
  if (shouldRemoveImage && !imagePath) {
    //이미지 삭제 요청 O + 새이미지 X ->기존이미지 제거, image_path 값 비우기
    //서버에서 기존 이미지 삭제

    //글 번호 삭제할 이미지의 경로 파악
    db.query("SELECT image_path FROM board WHERE id=?", [id], (err, result) => {
      if (err) throw err;
      const existingImagePath = result[0] ? result[0].image_path : null;
      deleteUploadedFile(existingImagePath);
    });

    sqlQuery = "UPDATE board SET writer=?, title=?, content=?, image_path=NULL WHERE id=?";
    params = [writer, title, content, id];
  } else if (imagePath) {
    //이미지 삭제 요청 X + 새 이미지 O --> 기존이미지 유지, image_path 새이미지 업데이트
    sqlQuery = "UPDATE board SET writer=?, title=?, content=?, image_path=? WHERE id=?";
    params = [writer, title, content, imagePath, id];
  } else {
    //이미지 삭제 요청 X + 새 이미지 X -> 이미지유지, 글정보만 변경
    sqlQuery = "UPDATE board SET writer=?, title=?, content=? WHERE id=?";
    params = [writer, title, content, id];
  }

  db.query(sqlQuery, params, (err, result) => {
    if (err) throw err;
    res.send(result);
  });
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
