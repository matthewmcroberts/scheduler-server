import express, { Request, Response, NextFunction, Router } from "express";
import { Me } from "../../models/me";
import { isLoggedIn, isProfessor, isStudent } from "../middleware/auth";
import { checkIfUserExists, getUpcomingMeetings, getUserbyEmail, getUserbyId, getUserbyUsername } from "../../mongo/queries/users";
import { changePassword, insertNewUser, resetPassword } from "../../mongo/mutations/users";
import bycrpt, { genSaltSync, hashSync } from "bcrypt";
import { User, UserRole } from "../../models/user";
import { MongoInsertError } from "../errors/mongo";
import { getAllStudents, getAllProfessors } from "../../mongo/queries/users";
import { BadRequestError, UnauthorizedError } from "../errors/user";
import { checkIfCodeMatches, resendEmailAuthCode, sendEmailAuthCode } from '../../mongo/queries/code';
import { checkPasswordComplexity } from "../config/utils/password-complexity";
import { ServerError } from "../errors/base";
import { ensureObjectId } from "../config/utils/mongohelper";
import { AppointmentStatus } from "../../models/appointment";
import { ObjectId } from "mongodb";

const router: Router = express.Router();
//test route
router.get("/ping", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.session.Me) {
      console.log(req.session.Me);
    } else {
      let me = new Me();
      me.username = "student";
      me.role = UserRole.Student;
      req.session.Me = me;
      res.json("pong");
    }
    res.json("done");
  } catch (err) {
    console.log(err);
  }
});

//add new user
router.post(
  "/register",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        username,
        password,
        email,
        role,
        major,
        minor,
        department,
        title,
        grade,
        gender,
        birthdate,
      } = req.body;

      //check if user exists
      const user = await checkIfUserExists(username);

      if (!user) {
        const salt = genSaltSync(10);
        const hashedPassword = hashSync(password, salt);
        const newUser = new User();
        newUser.username = username;
        newUser.password = hashedPassword;
        newUser.email = email;
        newUser.role = role;
        newUser.major = major;
        newUser.minor = minor;
        newUser.department = department;
        newUser.title = title;
        newUser.grade = grade;
        newUser.gender = gender;
        newUser.birthdate = new Date(birthdate);
        newUser.createdAt = new Date();
        newUser.updatedAt = new Date();

        const result = await insertNewUser(
          newUser.username,
          hashedPassword,
          newUser.role,
          newUser.email,
          newUser.major,
          newUser.minor,
          newUser.department,
          newUser.grade,
          newUser.gender,
          newUser.title,
          newUser.birthdate
        );
        res.json({ message: "User created successfully", result });
      } else {
        throw new MongoInsertError("User already exists");
        res.json({ message: "username already exists" });
      }
    } catch (err) {
      next(err);
    }
  }
);

//login 
router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body;
    const user = await getUserbyUsername(username);
    if(user) {
      const isPasswordCorrect = bycrpt.compareSync(password, user.password);
      if(isPasswordCorrect) {
        let me = new Me();
        me.username = username;
        me.role = user.role;
        req.session.Me = me;        
        console.log(req.session.Me);
        res.json({message: "Login successful", Me: req.session.Me.role});
      } else {
        throw new Error("Password is incorrect");
        res.json({message: "Password is incorrect"});
      }
    }
  } catch (err) {
    next(err);
  }
});

//profile
router.get(
  "/profile",
  isLoggedIn,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const me = req.session.Me;
      if (me) {
        res.json(me);
      } else {
        throw new Error("Unauthorized");
      }
    } catch (err) {
      next(err);
    }
  }
);

//get all students
router.get('/students', isLoggedIn, isProfessor, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const students = await getAllStudents();
    res.json(students);
  } catch (err) {
    next(err);
  }
});

//get all professors
router.get('/professors', isLoggedIn, isProfessor, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const professors = await getAllProfessors();
    res.json(professors);
  } catch (err) {
    next(err);
  }
});

//send code to user to reset their password
router.post('/sendcode', async (req: Request, res: Response, next: NextFunction) => {
  try {
      let email = req.body.email?.toString();
      let user = (await getUserbyEmail(email));
      if (email && user){
      if (user.email == email){
        let sendCode = await sendEmailAuthCode(user._id.toString(),email);
        if (sendCode){
          res.json({message:'You code was successfully sent', userId: user._id});
        } else {
          throw new Error("Could not send code");
          res.json({message: "Could not send code"});
        }
      } else {
        throw new Error("Email does not match our database");
        res.json({message: "Email does not match our database"});
      }
    } else {
      throw new Error("Invalid information");
      res.json({message: "Invalid information"});
    }
  } catch (err) {
      next(err);
  }
});

//compare code from databse to what the user entered to reset their password
router.post('/comparecode', async (req: Request, res: Response, next: NextFunction) => {
  try {
      let code = req.body.code?.toString();
      let userId = req.body.userId?.toString();

      if (userId && code) {
          let codeMatches = await checkIfCodeMatches(userId, code);
          if (codeMatches) {
            let user = await getUserbyId(userId);
            let me = new Me();
            me.username = user.username;
            me.role = user.role;
            req.session.Me = me;
            res.json({message: "Your code matches"});
            //can then change password

          } else {
            throw new Error("That code is not correct");
            res.json({message: "The code is not correct"});
          }
      } else {
        throw new Error("Invalid information");
        res.json({message: "Invalid information"});
      }
  } catch (err) {
      next(err);
  }
});

//resend code to user to reset their password if they never received it
router.post('/resendcode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let email = req.body.email.toString();
    if (email){

        let user = await getUserbyEmail(email);
        if (email == user.email){

          let sendCode = await resendEmailAuthCode(user._id.toString(),email);
          if (sendCode){
            res.json({message:'You code was successfully resent'})

          } else {
            throw new Error("Could not resend code");
            res.json({message: "Could not resend code"});
          }
        }else {
          throw new Error("Your email doesn't match our database");
          res.json({message: "Your email doesn't match our database"});
        }
      } else {
        throw new Error("Invalid information");
        res.json({message: "Invalid information"});
      }
  } catch (err) {
      next(err);
  }
});

//reset password after verifying with code
router.post("/resetPassword", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const me = req.session.Me;
    let newPassword1 = req.body.newPassword1.toString();
    let newPassword2 = req.body.newPassword2.toString();
    if (me){
      if (newPassword1 == newPassword2){
        let passcomplexity = await checkPasswordComplexity(newPassword1);
        if (passcomplexity){
          let userId = (await getUserbyUsername(me.username))._id;
          let update = await resetPassword(userId.toString(),newPassword1);
          if (update){
            res.json({message:'You successfully reset your password'})
          } else{
            throw new Error("Something went wrong with reseting your password");
            res.json({message: "Something went wrong with reseting your password"});
          }}
          else{
            throw new Error("Password is not complex enough");
            res.json({message:"Your password doesn't meet the requirements"})
          }
        } else {
          throw new Error("Passwords do not match");
          res.json({message: "Your passwords don't match"});
        }
    } else{ 
      throw new UnauthorizedError(`You are not authorized`);
      res.json({message: "You are not authorized"});
    }
  } catch (err) {
    next(err);
  }
});

router.post('/changepassword', isLoggedIn, async (req: Request, res: Response, next: NextFunction) => {
  try {
      const me = req.session.Me;
      const oldPassword = req.body.oldPassword.toString();
      const newPassword1 = req.body.newPassword1.toString();
      const newPassword2 = req.body.newpassword2.toString();
      if (me) {
          if (newPassword1 == newPassword2) {
              let complexity = await checkPasswordComplexity(newPassword1)
              if (complexity) {
                let userId = (await getUserbyUsername(me.username))._id;
                let insertPassword = await changePassword(me.username,userId.toString(), oldPassword,newPassword1);
                if (insertPassword) {
                    req.session.destroy((err) => { });
                    res.json( "Your password is changed." );
                } else {
                    throw new ServerError(`Something went wrong when changing password`);
                    res.json({message: "Something went wrong when changing password`"});
                }                                     
              } else {
                  throw new BadRequestError("The password doesn't meet the requirements");
                  res.json({message: "The password doesn't meet the requirements"});
              }
          } else {
              throw new BadRequestError("The passwords don't match");
              res.json({message: "The passwords don't match"});
          }
        } else {
        throw new UnauthorizedError(`You are not authorized`);
        res.json({message: "You are not authorized"});
          }
  } catch (err) {
      next(err);
  }
});

export default router;


//fetch all upcoming meetings
router.get('/upcoming', isLoggedIn, isStudent, async(req:Request, res:Response, next: NextFunction)=>{
  try {
    const student = req.session.Me ? req.session.Me._id: null;
    
    const status = AppointmentStatus.Accepted;
    if(student){
      const meetings = await getUpcomingMeetings(ensureObjectId(student), status);
    res.json(meetings);
  }
  } catch (err) {
    next(err);
  }
});