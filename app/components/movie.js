
import React from 'react'

const { ipcRenderer } = require('electron');
const path = require('path');

let userDataPathCache = null;

async function getUserDataPath() {
  if (!userDataPathCache) {
    userDataPathCache = await ipcRenderer.invoke('get-user-data-path');
  }
  return userDataPathCache;
}

export default class Movie extends React.Component {

  constructor(props) {
    super(props);
    this.state = {
      userDataPath: null
    };
  }

  async componentDidMount() {
    const userDataPath = await getUserDataPath();
    this.setState({ userDataPath });
  }

  render() {
  	var movie = this.props.data;
    const { userDataPath } = this.state;

    if (!userDataPath) {
      return <a href="#" className="movie" id={movie.imdbid}><div className="title">{movie.title}</div></a>;
    }

    return (
	      <a href="#" className="movie" onClick={this.props.onClick} id={movie.imdbid}>
    			<div className="image">
            <img src={path.join(userDataPath, "posters", movie.poster_path)} alt={movie.title} width="100%" />
          </div>
    			<div className="title">{movie.title}</div>
          <div className="meta">
      			<div className="year">{ (movie.type === 'series') ? movie.year.split("–")[0] : movie.year }</div>&nbsp;&nbsp;•&nbsp;&nbsp;
            <div className="rating">{movie.imdbrating}</div>
          </div>
	      </a>
    );
  }
}
